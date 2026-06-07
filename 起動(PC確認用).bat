@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  SAA 模試トレーナー  ローカルサーバを起動します
echo  ブラウザで http://localhost:8000/index.html を開きます
echo  停止: この黒い画面で Ctrl + C
echo ============================================================
start "" http://localhost:8000/index.html
python -m http.server 8000
