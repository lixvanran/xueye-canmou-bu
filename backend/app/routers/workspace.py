"""Workspace API - 用户文件上传到 workspace/uploads/
v0.9.1: 新增 - 用户把错题图片/PDF/Word 等文件传到 uploads/,
        然后在聊天里指示 Agent 自动归类到错题本

v2.0: 新增合并端点 POST /api/workspace/mistakes/{id}/explain
      一次性返回讲题 (4 步) + 标准答案, 流式

v0.1.7+: 新增 GET /api/workspace/image/{filename} — 错题图片渲染修复
       (前端 <img src="/api/workspace/image/xxx.png"> 直接走 API, 跳过 vite proxy
        — 兼容 vite preview (无 proxy) + 跨 origin + 老 uploads/ 路径)
"""
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from pathlib import Path
import uuid
import aiofiles
import json
import asyncio
import logging
from typing import AsyncGenerator

from app.core.config import settings
from app.db.database import get_db, ResourceORM
from app.agent.orchestrator import orchestrator
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/workspace", tags=["工作区"])


# 支持的文件类型
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
                      ".pdf", ".doc", ".docx", ".txt", ".md"}


@router.post("/upload")
async def upload_to_workspace(
    file: UploadFile = File(...),
    user_id: int = Form(1),
):
    """把文件上传到 workspace/uploads/ 目录

    用户在 Chat 页面通过 📎 按钮选文件, 或直接从桌面拖到 workspace/uploads/
    之后在聊天里说"把上传文件夹里的错题整理一下", Agent 会自动识别并归类
    """
    try:
        # 文件名校验
        if not file.filename:
            raise HTTPException(400, "文件名为空")

        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                400,
                f"不支持的文件类型: {ext}。允许: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            )

        # 生成唯一文件名 (保留原扩展名, 避免冲突)
        safe_stem = Path(file.filename).stem[:50]  # 限长
        unique_name = f"{safe_stem}_{uuid.uuid4().hex[:8]}{ext}"
        dest = settings.WORKSPACE_UPLOADS_DIR / unique_name

        # 写入
        content_bytes = await file.read()
        async with aiofiles.open(dest, "wb") as f:
            await f.write(content_bytes)

        logger.info(f"Workspace upload: {file.filename} -> {dest} ({len(content_bytes)} bytes)")

        return {
            "success": True,
            "filename": unique_name,
            "original_name": file.filename,
            "path": f"uploads/{unique_name}",
            "absolute_path": str(dest),
            "size": len(content_bytes),
            "message": f"已上传到 workspace/uploads/{unique_name}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Workspace upload error: {e}")
        raise HTTPException(500, f"上传失败: {str(e)}")


@router.get("/uploads")
async def list_uploads():
    """列出 workspace/uploads/ 目录里的所有文件 (Agent 和前端都看)

    返回未处理文件列表, 供 Agent 扫描
    """
    try:
        uploads_dir = settings.WORKSPACE_UPLOADS_DIR
        if not uploads_dir.exists():
            return {"success": True, "items": [], "total": 0}

        items = []
        for p in sorted(uploads_dir.iterdir()):
            if p.name.startswith("."):
                continue  # 跳过 .gitkeep 等
            stat = p.stat()
            items.append({
                "name": p.name,
                "path": f"uploads/{p.name}",
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })
        return {"success": True, "items": items, "total": len(items)}
    except Exception as e:
        logger.error(f"List uploads error: {e}")
        return {"success": False, "error": str(e)}


# v0.1.7+: 错题图片渲染代理
# 前端 <img src="/api/workspace/image/xxx.png"> 直接走这个 endpoint
# 优先 UPLOAD_DIR (backend/data/uploads/), 兜底 WORKSPACE_UPLOADS_DIR (workspace/uploads/)
# 跳过 vite proxy, 兼容 vite preview / 跨 origin / 老 /uploads/ 路径
@router.get("/image/{filename}")
async def serve_image(filename: str):
    """错题图片渲染代理 — 兼容多个 uploads 目录

    Args:
        filename: 纯文件名 (不带路径), 例如 'abc-123.png'

    Returns:
        FileResponse (设置正确的 mime + cache)
    """
    # 防止 path traversal
    safe_name = Path(filename).name
    if safe_name != filename or ".." in filename:
        raise HTTPException(400, "非法的文件名")

    # 1) 优先 UPLOAD_DIR (backend/data/uploads/) — resources.py 写入目录
    p1 = settings.UPLOAD_DIR / safe_name
    if p1.exists():
        return _file_response(p1)

    # 2) 兜底 WORKSPACE_UPLOADS_DIR (workspace/uploads/) — 老用户 / workspace.py 写入目录
    p2 = settings.WORKSPACE_UPLOADS_DIR / safe_name
    if p2.exists():
        return _file_response(p2)

    raise HTTPException(404, f"图片不存在: {filename}")


# v0.1.7+: 测试数据清理 (用户 P0 反馈)
# 清空 conversations + messages + resources + schedules + facts + workspace/uploads/ 里的测试图片
# 保留 settings / user profile (用户的 persona / agent_name 等)
@router.post("/reset-test-data")
async def reset_test_data(db: Session = Depends(get_db)):
    """清空 Agent 测试留下的数据 — 用户的 P0 反馈:
    '你把好多你测试时候留下的会话/错题等记录一起留下了!'

    清空:
    - conversations + messages (会话 + 消息)
    - resources (错题 + 学习资料)
    - schedules + schedule_items (学习计划)
    - user_facts (长期事实)
    - chat_memory (Agent 短期记忆)
    - workspace/uploads/ 里的非 .gitkeep 文件

    保留:
    - users (用户基本资料, persona, agent_name)
    - settings (设置)
    - backend/data/uploads/ (resources 写入的真实图片, 但 db 记录会删, 所以图片孤立可保留)

    Returns:
        {cleared: {conversations: N, messages: N, resources: N, ...}}
    """
    try:
        from sqlalchemy import text

        # 取实际存在的表 (避免不存在的表报错)
        existing_tables = {row[0] for row in db.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))}
        # 安全清表名单 (按外键依赖反序)
        candidates = ["messages", "conversations", "schedule_items",
                      "schedules", "chat_memory", "user_facts", "resources"]
        counts = {}
        for t in candidates:
            if t in existing_tables:
                counts[t] = db.execute(text(f"DELETE FROM {t}")).rowcount
        db.commit()

        # 清 workspace/uploads/ 里的非隐藏文件 (用户的桌面拖入文件)
        uploads_cleared = 0
        uploads_dir = settings.WORKSPACE_UPLOADS_DIR
        if uploads_dir.exists():
            for p in uploads_dir.iterdir():
                if p.name.startswith("."):
                    continue
                try:
                    p.unlink()
                    uploads_cleared += 1
                except Exception as e:
                    logger.warning(f"清理 {p} 失败: {e}")

        logger.info(f"[reset-test-data] cleared: {counts}, uploads: {uploads_cleared}")
        return {"success": True, "cleared": counts, "uploads_cleared": uploads_cleared}
    except Exception as e:
        db.rollback()
        logger.error(f"reset-test-data failed: {e}")
        raise HTTPException(500, f"清理失败: {e}")


# MIME type 映射 (FileResponse 自动推断, 这里加强)
_MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


def _file_response(p: Path) -> FileResponse:
    """构造 FileResponse + cache + mime"""
    ext = p.suffix.lower()
    media_type = _MIME_MAP.get(ext, "application/octet-stream")
    return FileResponse(
        path=str(p),
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},  # 1 天缓存
    )


# ===== v2.0: 合并的错题讲解端点 =====
# 一次性返回讲题 (4 步工作流) + 标准答案, 流式
# 历史端点 (按 spec 描述的旧版): 返回 410 Gone + 提示新端点
@router.post("/mistakes/{mistake_id}/explain")
async def explain_mistake(
    mistake_id: int,
    db: Session = Depends(get_db),
):
    """v2.0: 合并版错题讲解端点 — 一次性讲题 (4 步) + 标准答案, SSE 流式

    流程:
    - 拿 mistake 详情 (id 不存在 → 404)
    - 用 orchestrator 跑两遍:
        1) 讲题 prompt (4 步工作流, scenario='exam')
        2) 标准答案 prompt (scenario='exam')
    - 两段都流式推给前端, 用 [STEP] / [SOLUTION] 标签分隔

    SSE 事件格式:
      [STEP] "讲题第 1 步..."
      [SOLUTION] "标准答案..."
      [DONE]
    """
    r = db.query(ResourceORM).filter_by(id=mistake_id).first()
    if not r:
        raise HTTPException(404, f"找不到错题 id={mistake_id}")
    if r.type != "mistake":
        raise HTTPException(400, f"id={mistake_id} 不是错题 (type={r.type})")

    user_id = r.user_id
    mistake_context = (
        f"错题编号: {r.code or f'id={r.id}'}\n"
        f"学科: {r.subject or '未指定'}\n"
        f"知识点: {r.knowledge_point or '未指定'}\n"
        f"错误类型: {r.error_type or '未指定'}\n"
        f"用户备注: {r.notes or '无'}\n\n"
        f"题目内容:\n{r.content or '(题目内容为空)'}"
    )

    async def generate() -> AsyncGenerator[str, None]:
        # ===== 第一段: 讲题 (4 步工作流) =====
        explain_prompt = (
            "请按以下 4 步工作流讲这道错题, 每步独立成段, 不要一次性输出全部:\n"
            "**步骤 1: 理解题目** — 先做一遍, 说清楚考察什么\n"
            "**步骤 2: 询问思路** — 问学生自己怎么想\n"
            "**步骤 3: 评估方向** — 根据情况 A/B/C 引导\n"
            "**步骤 4: 收尾** — 总结错因 + 注意事项\n\n"
            f"{mistake_context}"
        )
        step_header = json.dumps(
            {'tag': 'STEP', 'content': '【讲题 4 步工作流】\n\n'},
            ensure_ascii=False,
        )
        yield f"data: {step_header}\n\n"
        try:
            async for chunk in orchestrator.process_message_stream(
                user_message=explain_prompt,
                scenario="exam",
                user_id=user_id,
                conversation_id=None,
                deep_thinking_enabled=False,
            ):
                chunk_payload = json.dumps(
                    {'tag': 'STEP', 'content': chunk}, ensure_ascii=False,
                )
                yield f"data: {chunk_payload}\n\n"
        except Exception as e:
            logger.error(f"explain_mistake step-stream error: {e}")
            err_payload = json.dumps(
                {'tag': 'STEP_ERROR', 'error': str(e)}, ensure_ascii=False,
            )
            yield f"data: {err_payload}\n\n"

        # ===== 第二段: 标准答案 =====
        solution_prompt = (
            "请给出这道题的**标准答案 + 详细解题过程**:\n"
            "- 完整步骤, 不要省略\n"
            "- 关键公式要写\n"
            "- 最终答案明确标出\n\n"
            f"{mistake_context}"
        )
        solution_header = json.dumps(
            {'tag': 'SOLUTION', 'content': '\n\n【标准答案】\n\n'},
            ensure_ascii=False,
        )
        yield f"data: {solution_header}\n\n"
        try:
            async for chunk in orchestrator.process_message_stream(
                user_message=solution_prompt,
                scenario="exam",
                user_id=user_id,
                conversation_id=None,
                deep_thinking_enabled=False,
            ):
                sol_payload = json.dumps(
                    {'tag': 'SOLUTION', 'content': chunk}, ensure_ascii=False,
                )
                yield f"data: {sol_payload}\n\n"
        except Exception as e:
            logger.error(f"explain_mistake solution-stream error: {e}")
            sol_err = json.dumps(
                {'tag': 'SOLUTION_ERROR', 'error': str(e)}, ensure_ascii=False,
            )
            yield f"data: {sol_err}\n\n"

        # ===== 持久化标准答案到 Resource.solution (供前端错题本看) =====
        try:
            # 重新查 session (上一个 db session 已经被 generator 用过, 不能再用)
            from app.db.database import SessionLocal
            fresh_db = SessionLocal()
            try:
                fresh_r = fresh_db.query(ResourceORM).filter_by(id=mistake_id).first()
                if fresh_r and not fresh_r.solution:
                    # 这里不再 LLM 重新生成 (避免重复), 由前端按需调 save-solution 端点
                    # 留接口给前端 POST /api/resources/{id}/update?solution=...
                    pass
            finally:
                fresh_db.close()
        except Exception:
            pass

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ===== v2.0: 旧端点返回 410 Gone =====
# 旧版"讲题"和"一键生成标答"两个端点已经合并到 /api/workspace/mistakes/{id}/explain
# 保留这两个 stub 以防前端误调, 返回 410 + 迁移提示
@router.post("/mistakes/{mistake_id}/explain-step-by-step")
async def legacy_explain_step_by_step(mistake_id: int):
    """v2.0: 已废弃. 旧版讲题端点已合并到 /api/workspace/mistakes/{id}/explain"""
    raise HTTPException(
        status_code=410,
        detail={
            "error": "Endpoint deprecated",
            "message": (
                f"旧的逐步讲题端点已废弃. "
                f"请改用 POST /api/workspace/mistakes/{mistake_id}/explain "
                f"(一次性返回讲题 4 步 + 标准答案, 流式)."
            ),
            "new_endpoint": f"/api/workspace/mistakes/{mistake_id}/explain",
        }
    )


@router.post("/mistakes/{mistake_id}/generate-answer")
async def legacy_generate_answer(mistake_id: int):
    """v2.0: 已废弃. 旧版一键生成标答端点已合并到 /api/workspace/mistakes/{id}/explain"""
    raise HTTPException(
        status_code=410,
        detail={
            "error": "Endpoint deprecated",
            "message": (
                f"旧的一键生成标答端点已废弃. "
                f"请改用 POST /api/workspace/mistakes/{mistake_id}/explain "
                f"(一次性返回讲题 4 步 + 标准答案, 流式)."
            ),
            "new_endpoint": f"/api/workspace/mistakes/{mistake_id}/explain",
        }
    )


# ===== v2.0: 错题薄弱点分析 =====
@router.post("/mistakes/weak-topics")
async def weak_topics(
    user_id: int = 1,
    top_k: int = 5,
    db: Session = Depends(get_db),
):
    """v2.0: 分析该用户的薄弱知识点 (top 5)

    统计逻辑:
      - 扫该用户所有错题 (type=mistake)
      - 把每道题的 knowledge_tags 拆出来, 计数
      - 掌握度加权: 未掌握=2x, 已掌握=0.5x (让"还没掌握"的优先级高)
      - 按权重倒序取 top_k
      - 返回 [{tag, weight, mistake_count, unmastered_count, difficulty_avg}]

    ChatPage "分析薄弱点" 按钮直接调这个端点, 渲染前 5 个知识盲点
    """
    from sqlalchemy import func as _func, or_

    items = (
        db.query(ResourceORM)
        .filter(ResourceORM.user_id == user_id, ResourceORM.type == "mistake")
        .all()
    )

    # {tag: {weight, mistake_count, unmastered_count, difficulty_sum, difficulty_n}}
    agg: dict = {}
    for r in items:
        tags = r.knowledge_tags if isinstance(r.knowledge_tags, list) else []
        if not tags:
            continue
        # 兜底: 如果没有 knowledge_tags, 用 knowledge_point
        if not tags and r.knowledge_point:
            tags = [r.knowledge_point]
        if not tags:
            continue
        mult = 0.5 if r.mastered else 2.0
        for t in tags:
            if not isinstance(t, str):
                continue
            t = t.strip()
            if not t:
                continue
            entry = agg.setdefault(t, {
                "weight": 0.0,
                "mistake_count": 0,
                "unmastered_count": 0,
                "difficulty_sum": 0,
                "difficulty_n": 0,
            })
            entry["weight"] += mult
            entry["mistake_count"] += 1
            if not r.mastered:
                entry["unmastered_count"] += 1
            if r.difficulty:
                entry["difficulty_sum"] += r.difficulty
                entry["difficulty_n"] += 1

    rows = []
    for tag, e in agg.items():
        rows.append({
            "tag": tag,
            "weight": round(e["weight"], 2),
            "mistake_count": e["mistake_count"],
            "unmastered_count": e["unmastered_count"],
            "difficulty_avg": (
                round(e["difficulty_sum"] / e["difficulty_n"], 1)
                if e["difficulty_n"] else None
            ),
        })
    rows.sort(key=lambda x: (-x["weight"], -x["unmastered_count"], x["tag"]))

    # 全错题统计 (给前端一个总览)
    total = (
        db.query(_func.count(ResourceORM.id))
        .filter(ResourceORM.user_id == user_id, ResourceORM.type == "mistake")
        .scalar() or 0
    )
    unmastered = (
        db.query(_func.count(ResourceORM.id))
        .filter(
            ResourceORM.user_id == user_id,
            ResourceORM.type == "mistake",
            ResourceORM.mastered == False,  # noqa: E712
        )
        .scalar() or 0
    )

    return {
        "user_id": user_id,
        "total_mistakes": int(total),
        "unmastered_count": int(unmastered),
        "top_k": top_k,
        "weak_topics": rows[:top_k],
        "all_topics": rows,  # 备用, 前端需要时可拿全集
    }