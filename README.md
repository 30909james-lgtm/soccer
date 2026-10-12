# FOOTBALL ARENA ONLINE — 1v1

一個可以建立房間、分享 5 位房間代碼、兩人即時對戰的 3D 足球遊戲。

## 本機測試
需求：Node.js 18 或更新版本。

```bash
npm install
npm start
```

瀏覽器開啟 http://localhost:3000 。同一台電腦可以開兩個瀏覽器視窗測試：第一個建立房間，第二個輸入房間代碼加入。

## 部署到 Render（推薦）
1. 將整個專案資料夾上傳到你自己的 GitHub repository。
2. 登入 Render，選 **New + → Web Service**，連結該 GitHub repository。
3. Runtime 選 Node；Build Command 填 `npm install`；Start Command 填 `npm start`。
4. 建立服務並等待部署完成。Render 會提供 `https://你的服務名稱.onrender.com` 網址。
5. 你和朋友都打開同一個網址，一個按「建立房間」，另一個輸入代碼按「加入朋友的房間」。
6. 若服務在免費方案上休眠，第一次開啟可能要等服務喚醒；兩人都必須使用同一個部署網址。

## 操作
- WASD 或方向鍵：移動
- Shift：衝刺
- Space：射門（靠近球時）
- E：傳球／向前踢球
- 手機：左下搖桿移動，右下按鈕傳球、射門、衝刺

## 專案結構
- `server.js`：房間、比分、球員移動、球物理、進球與計時的伺服器權威邏輯
- `public/index.html`：3D 場景、房間 UI、鍵盤／手機控制
- `package.json`：Node.js 相依套件與啟動指令

## 注意
- 這是休閒遊戲原型，球物理和碰撞採簡化模型，不是正式競技物理。
- 需要 Node.js 伺服器，不能只用 `file://` 直接開 HTML 來連線。
- Socket.IO 會使用 WebSocket，並在必要時回退到 polling；部署平台必須允許長連線。
