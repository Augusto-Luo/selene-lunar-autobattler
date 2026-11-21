#!/bin/zsh
cd -- "${0:A:h}" || exit 1

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print '请先安装 Node.js 22.12 或更高版本。'
  read -r '?按回车关闭…'
  exit 1
fi

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  npm ci || { read -r '?依赖安装失败，按回车关闭…'; exit 1; }
fi

print '本地试玩：http://127.0.0.1:5173/（按 Control+C 停止）'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort --open
status_code=$?
if (( status_code != 0 )); then
  read -r '?启动失败，检查上方提示后按回车关闭…'
fi
exit "$status_code"
