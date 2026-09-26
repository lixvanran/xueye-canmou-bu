"""Nuwa Skill 框架接入 (预留, v2.0)

设计目标:
- 扫描 ~/.nuwa/skills/*/SKILL.md, 解析 frontmatter 返回可用 skill 列表
- 找不到 nuwa 路径就返回空 list, **不 crash** (本地开发没装 nuwa 也得能跑)
- 当前版本: 只 read, 不实际注册到 LLM tool_calls (留给后续 v2.x)

日志约定: 启动时打一行 "nuwa-skill 框架已就绪, 当前加载 N 个 skill"
"""
import logging
import os
from pathlib import Path
from typing import List, Dict, Optional, Any

logger = logging.getLogger(__name__)


# ===== 路径探测 =====
def _candidate_nuwa_paths() -> List[Path]:
    """返回若干候选 nuwa skills 目录 (按优先级). 第一个存在的会被用."""
    paths: List[Path] = []

    # 1. 环境变量覆盖
    env = os.environ.get("NUWA_SKILLS_DIR")
    if env:
        paths.append(Path(env).expanduser())

    # 2. ~/.nuwa/skills/ (默认)
    paths.append(Path.home() / ".nuwa" / "skills")

    # 3. 项目内 .nuwa/skills/ (本地开发兜底)
    project_local = Path(__file__).resolve().parent.parent.parent.parent / ".nuwa" / "skills"
    paths.append(project_local)

    # 4. 项目内 workspace/nuwa-skills/ (用户拖进来)
    workspace_local = Path(__file__).resolve().parent.parent.parent.parent / "workspace" / "nuwa-skills"
    paths.append(workspace_local)

    return paths


def _resolve_skills_dir() -> Optional[Path]:
    for p in _candidate_nuwa_paths():
        try:
            if p.exists() and p.is_dir():
                return p
        except (OSError, PermissionError):
            continue
    return None


# ===== frontmatter 解析 (轻量, 不引入 pyyaml 依赖) =====
def _parse_frontmatter(md_text: str) -> Dict[str, str]:
    """极简 frontmatter 解析 — 只支持 `---` 包裹的 `key: value` 对."""
    meta: Dict[str, str] = {}
    lines = md_text.splitlines()
    if not lines or lines[0].strip() != "---":
        return meta
    # 找第二个 ---
    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return meta
    for line in lines[1:end_idx]:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if ":" in s:
            k, _, v = s.partition(":")
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta


def _extract_description_from_body(md_text: str) -> str:
    """body 第一段非空文字 = description fallback."""
    lines = md_text.splitlines()
    in_body = False
    seen_sep = False
    for line in lines:
        s = line.strip()
        if not seen_sep:
            if s == "---":
                if not in_body:
                    in_body = True
                else:
                    seen_sep = True
            continue
        if s and not s.startswith("#"):
            return s[:200]
    return ""


# ===== 公开函数 =====
def list_skills() -> List[Dict[str, Any]]:
    """扫 ~/.nuwa/skills/*/SKILL.md, 返回 [{name, description, path}, ...]
    找不到 nuwa 路径就返回 [], 不抛异常.
    """
    skills_dir = _resolve_skills_dir()
    if not skills_dir:
        return []

    results: List[Dict[str, Any]] = []
    try:
        for entry in sorted(skills_dir.iterdir()):
            if not entry.is_dir():
                continue
            skill_md = entry / "SKILL.md"
            if not skill_md.exists():
                continue
            try:
                text = skill_md.read_text(encoding="utf-8", errors="ignore")
            except Exception as e:
                logger.debug(f"nuwa skill read failed: {skill_md} -> {e}")
                continue

            meta = _parse_frontmatter(text)
            name = meta.get("name") or entry.name
            description = meta.get("description") or _extract_description_from_body(text)
            results.append({
                "name": name,
                "description": description,
                "path": str(skill_md),
                "dir": str(entry),
            })
    except Exception as e:
        logger.warning(f"nuwa list_skills scan failed: {e}")
        return []

    return results


def load_skill(skill_name: str) -> Optional[Dict[str, Any]]:
    """读 ~/.nuwa/skills/{skill_name}/SKILL.md 的 frontmatter + 前 200 字 body.
    找不到返回 None.
    """
    skills_dir = _resolve_skills_dir()
    if not skills_dir:
        return None

    skill_dir = skills_dir / skill_name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None

    try:
        text = skill_md.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        logger.warning(f"load_skill({skill_name}) read failed: {e}")
        return None

    meta = _parse_frontmatter(text)
    body_preview = _extract_description_from_body(text)
    return {
        "name": meta.get("name", skill_name),
        "description": meta.get("description", body_preview),
        "version": meta.get("version", ""),
        "author": meta.get("author", ""),
        "path": str(skill_md),
        "body_preview": body_preview,
    }


def warmup_log() -> int:
    """启动时调用一次, 打印加载到的 skill 数量. 返回数量 (用于 health 端点)."""
    try:
        skills = list_skills()
        count = len(skills)
        logger.info(f"nuwa-skill 框架已就绪, 当前加载 {count} 个 skill")
        return count
    except Exception as e:
        logger.warning(f"nuwa-skill warmup failed (框架仍可用): {e}")
        return 0