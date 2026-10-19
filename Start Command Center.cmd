@echo off
title Command AI
cd /d "%~dp0"
if not exist node_modules (echo Installing... & call npm install --silent)
start "" http://localhost:4747
node server\index.js
