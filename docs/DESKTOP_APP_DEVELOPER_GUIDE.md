# 🖥️ คู่มือการทำงานต่อสำหรับ Desktop App & Mini HUD (Desktop Handover Guide)

> **สำหรับผู้พัฒนาและ AI ที่เข้ามารับช่วงต่อ:** เอกสารนี้สรุปโครงสร้าง สถาปัตยกรรม วิธีการบิลด์ และวิธีอัปเดตระบบ **Boss Tracker Desktop Application & Mini HUD** ทั้งหมด เพื่อให้คุณทำงานต่อได้ทันที **โดยไม่ต้องเสียเวลาค้นหาโค้ดหรืออธิบายซ้ำ**

---

## 📌 1. ภาพรวมสถาปัตยกรรม (Architecture Overview)

ระบบ Desktop App พัฒนาด้วย **Electron (v33)** แบ่งการทำงานออกเป็น 3 หน้าต่างหลัก:

```mermaid
flowchart TD
    MainProc["Electron Main Process (main.js)"]
    MainWindow["1. Main Dashboard Window\n(โหลด https://boss-time-eloni.vercel.app/)\n[Audio Master / Settings]"]
    HudWindow["2. Mini Game HUD Overlay (overlay/index.html)\n[โปร่งแสง / Always-on-top / คลิกทะลุ Alt+F12]"]
    ToastWindow["3. Top-Most Toast Overlay (toast.html)\n[ป๊อปอัพแจ้งเตือนบอสเกิดมุมซ้ายล่าง ไม่ดึงโฟกัสเกม]"]
    GitHub["GitHub Releases API\n(ตรวจเช็ค & ดาวน์โหลดอัปเดต)"]

    MainProc --> MainWindow
    MainProc --> HudWindow
    MainProc --> ToastWindow
    MainProc <-->|IPC Bridge (preload.js)| MainWindow
    MainProc <-->|IPC Bridge (preload.js)| HudWindow
    MainProc <-->|Auto-Update Polling| GitHub
```

### หน้าต่างทั้ง 3 บาน:
1. **`mainWindow` (Full Dashboard):** โหลดเว็บหลัก `https://boss-time-eloni.vercel.app/` ทำหน้าที่เป็น **Audio Master** ตัวเดียวเพื่อไม่ให้เสียงแจ้งเตือนตีกัน และแสดงแบนเนอร์แจ้งเตือนอัปเดตเวอร์ชันใหม่
2. **`hudWindow` (Mini HUD):** หน้าต่างโปร่งแสง ไร้ขอบ (Frameless) ลอยทับเกมตลอดเวลา แสดงเวลานับถอยหลังบอส/กิจกรรม มีปุ่มลัดสลับคลิกทะลุ (`Alt+F12`), ปรับขนาดฟอนต์ 10–18px, เลือกฟอนต์ Google Fonts 7 แบบ และมีปุ่ม `🚀 อัปเดต vX.X.X` แสดงขึ้นมาเมื่อมีเวอร์ชันใหม่
3. **`toastOverlayWindow` (Toast Notification):** ป๊อปอัพมุมซ้ายล่าง ลอยเหนือทุกโปรแกรม (`screen-saver` level) ไม่ดึงโฟกัสเกม และคลิกเมาส์ทะลุ 100%

---

## 🗂️ 2. แผนผังไฟล์สำคัญ (Directory & File Map)

| ไฟล์ / โฟลเดอร์ | หน้าที่ | คำอธิบายสำคัญ |
| :--- | :--- | :--- |
| `desktop-app/main.js` | ควบคุม Lifecycle ของ Electron ทั้งหมด | ระบบ Auto Elevate Admin, การสร้างหน้าต่าง, คีย์ลัดโกลบอล, และระบบ **In-App Auto-Update** |
| `desktop-app/preload.js` | IPC Bridge ระหว่างหน้าเว็บกับ Electron | ให้บริการ `window.electronAPI` และฝัง **Update Banner UI** ในหน้าต่างหลัก |
| `desktop-app/overlay/index.html` | โครงสร้างหน้าต่าง Mini HUD | แถบควบคุมบนสุด, ปุ่ม `btnHudUpdate`, และกล่องตั้งค่า |
| `desktop-app/overlay/overlay.js` | ลอจิกการทำงานของ Mini HUD | ดึงข้อมูลบอส, นับถอยหลัง, ควบคุมความโปร่งแสง, จัดการปุ่มกดอัปเดต |
| `desktop-app/overlay/overlay.css` | สไตล์ของ Mini HUD | ธีม Discord Dark Glass, แอนิเมชันปุ่มอัปเดตสีทองกะพริบ (`hudUpdatePulse`) |
| `scripts/build-installer.js` | คอมไพเลอร์สร้าง **Windows Installer** | ใช้ NSIS (`makensis.exe`) สร้าง `BossTracker-Setup.exe` พร้อมไอคอนบนเดสก์ท็อป |
| `scripts/pack-desktop.js` | แพ็กโค้ด `app.asar` และ Portable Zip | รวมโค้ดเป็น `.asar` และสร้าง `BossTracker-Windows-Portable.zip` |
| `scripts/release-desktop-app.js` | **สคริปต์ปล่อยเวอร์ชันใหม่ของ Desktop App** | บิลด์ตัวติดตั้ง + zip แล้วอัปโหลดเข้า GitHub Releases โดย **ไม่แตะต้อง Vercel** |

---

## 💻 3. ระบบตัวติดตั้ง Windows Installer (`BossTracker-Setup.exe`)

สร้างขึ้นด้วย NSIS (Nullsoft Scriptable Install System) ผ่าน `scripts/build-installer.js`

### คุณสมบัติของตัวติดตั้ง:
- **สร้างไอคอนบน Desktop อัตโนมัติ 100%:** สร้างชอร์ตคัต `Boss Tracker.lnk` ที่โฟลเดอร์หน้าจอเดสก์ท็อปของผู้ใช้ พร้อมไอคอน `icon.ico`
- **สร้างชอร์ตคัตใน Start Menu:** โฟลเดอร์ `Start Menu\Programs\Boss Tracker`
- **ลงทะเบียนใน Windows Add/Remove Programs:** ถอนการติดตั้งได้สะอาดผ่าน Windows Settings
- **รองรับโหมด Silent (`/S`):** สามารถสั่งรันติดตั้งแบบเงียบในเบื้องหลัง เพื่อใช้ในระบบ Auto-Update โดยเมื่อติดตั้งเสร็จในโหมดเงียบ ระบบจะสั่งเปิด `BossTracker.exe` ตัวใหม่ขึ้นมาอัตโนมัติทันที

---

## 🚀 4. วิธีปล่อยเวอร์ชันใหม่ (Release Workflow) — "Zero Vercel Deploy"

> [!IMPORTANT]
> **กฎเหล็ก:** เมื่อแก้ไขเฉพาะตัว Desktop App (เช่น แก้ HUD, แก้ปุ่มลัด, แก้ไขหน้าต่าง) **ห้ามดีพลอย Vercel เด็ดขาด** เพราะเซิร์ฟเวอร์เว็บไม่เกี่ยวข้องกัน ให้ใช้สคริปต์ Release เฉพาะ Desktop App ตามนี้:

### คำสั่งปล่อยเวอร์ชันใหม่แบบคำสั่งเดียว:

```bash
# กรณีใช้เลขเวอร์ชันเดิมที่อยู่ใน desktop-app/package.json
npm run release:desktop

# หรือระบุเลขเวอร์ชันใหม่ที่ต้องการปล่อย (เช่น 1.3.48)
node scripts/release-desktop-app.js 1.3.48
```

### สิ่งที่สคริปต์จะทำให้อัตโนมัติ:
1. อัปเดตเลขเวอร์ชันใน `desktop-app/package.json`
2. แพ็กไฟล์ `app.asar` ล่าสุดลงใน `dist/win-unpacked/resources/app.asar`
3. สร้าง `BossTracker-Windows-Portable.zip`
4. รัน `scripts/build-installer.js` เพื่อสร้าง `BossTracker-Setup.exe` (มีไอคอนหน้าจอ)
5. ดึง Token จาก Git Credential Manager แล้วไปสร้าง Release `vX.X.X` บน GitHub
6. อัปโหลดทั้ง `BossTracker-Setup.exe` และ `BossTracker-Windows-Portable.zip` ขึ้น GitHub Releases
7. **เซิร์ฟเวอร์ Vercel ไม่ถูกแตะต้องเลย ผู้ใช้บนเว็บใช้งานได้ต่อเนื่อง 100%**

---

## 🔄 5. กลไกการอัปเดตอัตโนมัติ (In-App Auto-Update Mechanism)

### 1. การตรวจจับเวอร์ชันใหม่ (Update Detection):
- ใน `desktop-app/main.js` มีฟังก์ชัน `checkForUpdates()`
- รันตรวจสอบทุกๆ 20 นาที และ 7 วินาทีหลังเปิดโปรแกรม
- ยิง API ไปที่ `https://api.github.com/repos/tinnakornid2/Boss-time/releases/latest`
- นำ `tag_name` (เช่น `v1.3.48`) มาเทียบกับ `currentDesktopVersion` ด้วยฟังก์ชัน `isNewerVersion()`

### 2. การแจ้งเตือน (Notifications):
- **ในหน้าต่างหลัก (Main Window):** ฝังป๊อปอัพแบนเนอร์กระจกมืดเรืองแสงมุมขวาล่าง:
  - หัวข้อ: `🚀 มีการอัปเดตเวอร์ชันใหม่! Boss Tracker v1.3.48`
  - ปุ่ม: `[ 📥 อัปเดตทันที (อัตโนมัติ) ]` และ `[ ไว้ภายหลัง ]`
- **ในหน้าต่าง Mini HUD:**
  - แสดงปุ่มสีทองนีออนกะพริบที่แถบหัวด้านบน: `[ 🚀 อัปเดต v1.3.48 ]`
  - แสดงข้อความ Toast ใน HUD แจ้งเตือนผู้เล่น

### 3. การดาวน์โหลดและติดตั้ง (Download & Self-Install):
- เมื่อผู้ใช้กดปุ่มอัปเดต:
  1. `main.js` สตรีมดาวน์โหลดไฟล์ `BossTracker-Setup.exe` ไปไว้ที่โฟลเดอร์ Temp (`%TEMP%\BossTracker-Setup-Update-....exe`)
  2. รองรับ Redirect 302 ของ GitHub ไปยัง AWS S3 Storage อัตโนมัติ
  3. ส่งความคืบหน้าเปอร์เซ็นต์ (`update-download-progress`) ให้ทั้งหน้าต่างหลักและ Mini HUD แสดง Progress Bar แบบเรียลไทม์
  4. เมื่อดาวน์โหลดเสร็จครบ 100%:
     - สั่งเปิดตัวติดตั้งแบบเงียบ: `spawn(tempPath, ['/S'], { detached: true, stdio: 'ignore' })`
     - สั่งปิดตัวเองลง: `app.isQuitting = true; app.quit();`
  5. ตัวติดตั้ง NSIS ในโหมดเงียบจะเขียนทับไฟล์เดิม, สร้างไอคอนบน Desktop ใหม่ และรัน `BossTracker.exe` ตัวใหม่ขึ้นมาอัตโนมัติ!

---

## 🛠️ 6. ขั้นตอนการทดสอบในเครื่องก่อนปล่อย (Local Testing)

```bash
# 1. ทดสอบรัน Desktop App ในเครื่อง
cd desktop-app
npm start

# 2. ทดสอบแพ็กไฟล์และสร้างตัวติดตั้งในเครื่อง
node scripts/pack-desktop.js
node scripts/build-installer.js

# 3. ไฟล์ผลลัพธ์จะอยู่ที่:
# - desktop-app/dist/BossTracker-Setup.exe (ตัวติดตั้งพร้อมไอคอนหน้าจอ)
# - desktop-app/dist/BossTracker-Windows-Portable.zip (ตัวพกพา)
```

---

## 🔒 7. ข้อควรระวังและกฎเกณฑ์สำคัญ (Critical Rules)

1. **ห้ามยิง Firebase หรือ GitHub ถี่เกินไป:** ตัวตรวจจับอัปเดตรันรอบละ 20 นาทีเท่านั้น
2. **Audio Master ต้องอยู่ที่ `mainWindow` เสมอ:** หน้าต่าง HUD และ Toast ห้ามเล่นเสียงซ้ำเดี่ยวๆ เพื่อป้องกันเสียงก้อง/เบิ้ล
3. **อย่าแตะต้อง `server/data/store.json`:** ไฟล์นี้เป็นข้อมูลเซิร์ฟเวอร์จริงของผู้ใช้ ห้าม commit หรือ overwrite เด็ดขาด
4. **Elevate Administrator:** ใน `desktop-app/main.js` บรรทัดแรกๆ มีคำสั่งตรวจจับและ Elevate เป็นสิทธิ์ Administrator เสมอ เพื่อให้ตัวโปรแกรมสามารถส่งเสียงและแสดงป๊อปอัพทับเกมที่รันด้วยสิทธิ์แอดมินได้ ห้ามลบคำสั่งนี้ออกเด็ดขาด

---

## 📌 8. ระบบจดจำตำแหน่งหน้าต่าง & การตรึง HUD บนหน้าจอ (Window Bounds & Always-On-Top)

### 1. ทำไมหน้าต่างหลักจำตำแหน่งเดิมไม่ได้เมื่อเปิดใหม่ (แก้ไขแล้ว):
- **สาเหตุเดิม:** Windows 10/11 มี Invisible Drop Shadow ขอบหน้าต่าง 7-8px เมื่อผู้ใช้ลากหน้าต่างชิดขอบซ้าย ค่า X จะเป็น `-5` หรือ `-7` โค้ดเดิมตรวจ `initialX < 0` แล้วรีเซ็ตค่าทิ้ง ทำให้ตำแหน่งที่บันทึกไว้ถูกเพิกเฉยทุกครั้ง!
- **การแก้ไข:** ใช้ `isBoundsVisibleOnAnyDisplay(bounds)` ตรวจสอบพื้นที่ทับซ้อนกับหน้าจอจริง (Work Area) รองรับทั้งกรณีหน้าต่างชิดขอบจอ และกรณีจอภาพหลายจอ (Multi-Monitor) ที่มีค่าพิกัดติดลบ ทำให้หน้าต่างเปิดขึ้นมาที่ตำแหน่งและขนาดเดิมเป๊ะ 100%

### 2. ทำไม HUD ชอบหายเวลาสลับไปใช้โปรแกรมอื่น (แก้ไขแล้ว):
- **สาเหตุเดิม:**
  1. ระดับ AlwaysOnTop เดิมใช้ `'floating'` ซึ่งบน Windows จะถูกลดลำดับ z-order ทันทีที่ผู้ใช้คลิกสลับไปโปรแกรมอื่น
  2. เมื่อกด Win+D หรือสลับโปรแกรม Windows จะส่งคำสั่ง Minimize/Hide ไปยังหน้าต่างที่ไม่มี Taskbar ทำให้ HUD หายไปโดยไม่มีปุ่มให้กดเรียกคืน
- **การแก้ไข:**
  1. ยกระดับ AlwaysOnTop เป็น `'screen-saver', 1` (ระดับสูงสุดใน Windows เทียบเท่า Game Overlay)
  2. กำหนด `minimizable: false` ป้องกันไม่ให้ Windows ย่อหน้าต่าง HUD
  3. ดักจับเหตุการณ์ `minimize`, `hide`, `blur` เพื่อกู้คืนและตรึงลำดับ z-order ให้อยู่บนสุดเสมอ
  4. เพิ่ม Heartbeat Timer ทุก 3 วินาที เพื่อ Re-assert `setAlwaysOnTop` ป้องกันเกมที่พยายามแย่ง Focus z-order

---

## 🔐 9. ระบบตรวจสอบการเข้าสู่ระบบสำหรับ Mini HUD (Authentication-Gated HUD Display)

### พฤติกรรมที่กำหนด (Specification):
1. **เมื่อยังไม่ได้ล็อกอินที่หน้าต่างหลัก (`mainWindow` อยู่ที่ `/login` หรือยังไม่ผ่านการยืนยันตัวตน):**
   - หน้าต่าง Mini HUD จะถูก **ซ่อนตัวโดยสมบูรณ์ (`show: false`, `hudWindow.hide()`)** ไม่โผล่ขึ้นมาบนหน้าจอเดสก์ท็อป และไม่แสดงรายการบอสใดๆ ทั้งสิ้น
   - ถาดระบบ (Tray Context Menu) จะแสดงสถานะ `🎯 Mini Game HUD (รอเข้าสู่ระบบที่หน้าต่างหลัก)` และหากผู้ใช้คลิก จะนำโฟกัสกลับมาที่หน้าต่างหลักเพื่อให้ผู้ใช้ล็อกอิน
   - การสลับโปรแกรม (App switch) หรือ Heartbeat จะไม่เผลอเปิด HUD ขึ้นมาหากยังไม่ได้ล็อกอิน
2. **เมื่อล็อกอินสำเร็จที่หน้าต่างหลัก (`mainWindow` นำทางเข้าสู่ Dashboard หรือ `/poll` คืนค่าสำเร็จ):**
   - ระบบจะตรวจจับเหตุการณ์ `did-navigate`, `did-navigate-in-page`, `did-finish-load` และ Polling Sync ทุก 2 วินาที
   - Mini HUD จะเปิดแสดงตัวขึ้นมาอัตโนมัติ (`hudWindow.showInactive()`) พร้อมข้อมูลเวลานับถอยหลังของบอสทันที
3. **เมื่อผู้ใช้กดออกจากระบบ (Logout) หรือเซสชันหมดอายุ:**
   - เมื่อ URL เปลี่ยนกลับไปยัง `/login` หรือผลลัพธ์ `/poll` ส่งกลับ `status: 401`
   - Mini HUD จะสั่งปิด/ซ่อนตัวเองทันที (`hudWindow.hide()`) พร้อมทั้งล้างข้อมูลบอสในหน่วยความจำของ HUD ให้ว่างเปล่า (`bossListContainer.innerHTML = ''`)

