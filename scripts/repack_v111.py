import zipfile, os, sys

def add_dir(zf, srcdir, prefix='', excl_dirs=None, excl_ext=None):
    excl_dirs = excl_dirs or set()
    excl_ext = excl_ext or set()
    base = os.path.basename(srcdir.rstrip('/'))
    for root, dirs, files in os.walk(srcdir):
        dirs[:] = [d for d in dirs if d not in excl_dirs]
        for f in files:
            if any(f.endswith(e) for e in excl_ext):
                continue
            p = os.path.join(root, f)
            rel = os.path.relpath(p, srcdir).replace(os.sep, '/')
            arc = prefix + base + '/' + rel
            zf.write(p, arc)

# 删除原 zip
target = '/tmp/学业参谋部_v1.1.11.zip'
if os.path.exists(target):
    os.remove(target)

with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
    # 后端代码 (去掉 __pycache__ + .pyc)
    add_dir(zf, 'backend/app', excl_dirs={'__pycache__', '.venv'}, excl_ext={'.pyc'})
    # 后端配置
    for f in ['backend/requirements.txt', 'backend/.env.example']:
        if os.path.isfile(f):
            zf.write(f)
    # 前端源码 (不带 node_modules)
    add_dir(zf, 'frontend', excl_dirs={'node_modules', '.tmp'}, excl_ext={'.tsbuildinfo', '.log'})
    # 顶层
    for f in ['启动.bat', '停止.bat', '诊断.bat', 'README.md', 'E2E_REPORT.md']:
        if os.path.isfile(f):
            zf.write(f)

size_mb = os.path.getsize(target) / 1024 / 1024
print(f'{size_mb:.1f} MB, {len(zf.namelist())} 个文件')

# 验证
zf = zipfile.ZipFile(target)
names = zf.namelist()
print('完整性:', 'PASS' if zf.testzip() is None else 'FAIL')
print('  backend/:', sum(1 for n in names if n.startswith('backend/')))
print('  frontend/:', sum(1 for n in names if n.startswith('frontend/')))
print('  frontend/package.json:', 'frontend/package.json' in names)
print('  frontend/dist/index.html:', 'frontend/dist/index.html' in names)
print('  frontend/vite.config.ts:', 'frontend/vite.config.ts' in names)
print('  frontend/public/avatars/teacher_zhang.jpg:', 'frontend/public/avatars/teacher_zhang.jpg' in names)
print('  frontend/public/games/zxf_running/index.html:', 'frontend/public/games/zxf_running/index.html' in names)
print('  头像:', sum(1 for n in names if '/avatars/' in n))
print('  游戏:', sum(1 for n in names if 'games/zxf_running' in n))
print('  node_modules:', any('node_modules' in n for n in names))
print('  __pycache__:', any('__pycache__' in n for n in names))
print('  顶层 .bat:', sum(1 for n in names if n.endswith('.bat')))