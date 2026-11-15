# ambient-sound-mixer — 環境音混音桌

靜態網頁（`index.html`＋`engine.js`＋`synth.js`＋`manual.html`＋PWA 檔），無建置步驟、無外部 JS 函式庫（只用 Google Fonts：Noto Sans TC、IBM Plex Mono）。port 8883。2026-11-15 建立：使用者從我先前列的「聲音相關發想」選了這個（原本歸在行銷／創作，實作時改放 `小工具/`，因為主要用途是讀書、助眠、工作背景音，匯出循環 WAV 給創作者是附加功能）。功能細節都是我自定。**尚未上線**：本機 git 已 commit、無遠端；上線前先問使用者（建 public repo 需使用者自己 `gh repo create`），visitor-badge 已預埋 `m255525.ambientsoundmixer`。

視覺：類比混音台（深炭灰機身、米白膠帶標籤、琥珀 LED、垂直推桿、旋轉旋鈕、指針 VU 表），刻意與 sonic-logo-studio（米白紙）、voice-control-game（深藍遊戲）不同。

## 架構
- `engine.js`（純函式，Node 可測）：`CHANNELS`（13 軌定義：id、旋鈕名稱、預設）、`PRESETS`（8 組）、`defaultMix`／`cleanMix`（讀任何來源都要先清洗，null 用預設值）、`activeIds`（開啟、未靜音、有獨奏時只取獨奏）、`compactMix`＋`encodeShare`（`#m=`）、`GEN.*` 事件產生器（[t0,t1) 區間、k＝旋鈕 0～1、`state` 讓分段排程延續）、`pomodoro`、`makeLoop`（多錄 xf 秒，等功率交叉淡化疊回開頭）、`normalize`、`encodeWAV`。
- `synth.js` `Mixer`：同一份程式給即時 `AudioContext`（`analyse:true` 加每軌與主輸出 analyser）與 `OfflineAudioContext`（匯出）。訊號鏈：每軌 `pre → drift → lv → panner → mute → bus`（另 `mute → send → 殘響`）；`bus＋殘響 → tone(lowpass) → master → fade → compressor → (analyser) → destination`。`apply(mix, ramp)` 設參數，`schedule(t1)` 把每條 live 軌從 `k.until` 排到 t1。
- **每個聲音事件自己一組節點＋包絡，互相重疊不打架**（海浪、陣風、雷、和弦都是）；不要改成在同一個 AudioParam 上串 ramp（setTarget 後接 linearRamp 起點會跳）。例外：溪流三頻帶與自然變化只用 `setTargetAtTime`；咖啡廳每位客人一條固定鏈，同一人的音節不重疊，所以包絡事件依時間排好。
- **效能**：短促爆裂聲（雨滴、劈啪、按鍵、時鐘）用 `burstBuf` 預先算好的立體聲樣本庫（頻率／長度／Q／聲道分桶，JS 寫的 RBJ 帶通），每次只要 BufferSource＋Gain。第一版每滴雨 4 個節點＋濾波器，離線 20 秒雨聲要 4.7 秒，改完 0.6 秒。
- 響度校正 `CAL`：用 Playwright 離線合成各軌 20 秒量 RMS 調整（連續類目標約 0.08、鳥／蟲／打字約 0.035、時鐘 0.02、雷 0.05）。改了某軌的音色要重量。
- 噪音緩衝固定種子 6 秒、頭尾 20ms 交叉淡化；殘響 IR 固定種子。

## index.html
- 即時排程：每 250ms `MX.schedule(currentTime + 1.2)`（分頁在背景時 3 秒，因為背景 setInterval 會被節流）。
- 匯出前先暫停即時播放（同時播放會讓離線合成慢約 4 倍：30 秒混音從 35.6 秒變 7.2 秒），完成後自動接著播；`playTok` 防止「恢復播放」蓋掉使用者剛按的暫停。
- 電平燈用 dB 刻度（-54～-6 dBFS），線性刻度時環境音只會亮 5%。
- 旋鈕：pointer 上下拖曳、滾輪、方向鍵、雙擊回預設，`role=slider`。推桿是 `writing-mode: vertical-lr; direction: rtl` 的 range。
- 睡眠定時：結束前 `SET.fade` 秒開始 `fadeTo(0)`，到點 stop。番茄鐘：以牆上時間計，換階段 `MX.chime()`（直接接 compressor，不受主推桿影響），休息時 fade 到 0.35。
- 主音量上限 `SET.cap` 只影響實際輸出（`capMix()`），不改存下來的混音。
- 測試掛鉤 `window.__asm`：`E`、`mix`、`MX`、`AC`、`Mixer`、`start`、`stop`。

## 標準配備
跑馬燈（共用 Apps Script，`asmMarquee`）、操作手冊（創作者區塊含 email 從 voice-control-game/manual.html 用 awk 整段複製）、使用警語（頁面＋首訪 modal：模擬音、小音量、**不是醫療或治療工具**、開車勿用、iPhone 背景會停）、加入主畫面、訪客計數器、⚙ 常用設定（播放／番茄鐘／匯出／資料／關於）。刪除用「再按一次確認」。

## 儲存（localStorage，全部 try/catch）
`asm-settings`、`asm-mix`（目前混音）、`asm-mine`（最多 40 組）、`asm-warned`、`asm-set-open`、`asmMarquee`。

## 測試
- `node tools/test_engine.mjs`（237 項：每個產生器×三種旋鈕的時間範圍／排序／NaN／密度、分段排程與一次排程數量一致、旋鈕方向、預設、cleanMix、獨奏靜音、分享、番茄鐘、無縫循環接縫、WAV）。
- 瀏覽器：`python -m http.server 8883`；Playwright 加 `--autoplay-policy=no-user-gesture-required`。2026-11-15 已驗證：13 軌離線合成無 NaN、情境播放、旋鈕拖曳、推桿自動開軌、獨奏／靜音、定時器、番茄鐘、收藏、分享連結開新頁、匯出 30 秒 WAV（2ch 44.1k 30.0 秒、接縫連續）、暫停、390px 無溢出、console 無錯誤。
- **真人耳朵聽感未經使用者確認**（哪軌不像就調 `synth.js` 的 `events()` 對應段落與 `CAL`）。
