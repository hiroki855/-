@echo off
rem ───────────────────────────────────────────────
rem プリザンター CSV取込バッチ 実行用
rem  ・このbatファイルと同じフォルダにある import_pleasanter.py を実行する
rem  ・最後に pause を入れているので、ウィンドウは自動で閉じない
rem ───────────────────────────────────────────────
cd /d %~dp0
python import_pleasanter.py
pause
