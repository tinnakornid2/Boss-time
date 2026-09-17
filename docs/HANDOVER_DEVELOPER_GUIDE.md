# 🧭 คู่มือการส่งต่องานสำหรับผู้พัฒนาและ AI (Developer Handover Guide) - v1.3.27

> **สำหรับผู้พัฒนาและ AI ที่เข้ามารับช่วงต่อ:** เอกสารนี้สรุปโครงสร้าง สถาปัตยกรรม และจุดสำคัญทั้งหมดของระบบ เพื่อให้คุณเข้าใจและทำงานต่อได้ทันที **โดยไม่ต้องเสียเวลาอ่านโค้ดทีละบรรทัดทั้งโปรเจกต์**

---

## 📌 1. ภาพรวมระบบ (High-Level Architecture)

- **โปรดักชัน URL:** https://boss-time-eloni.vercel.app/
- **จุดกู้คืนหลัก (Stable Tag):** `stable-v1.3.27` (Recovery points: `stable-v1.3.26`, `stable-v1.3.25`, `stable-v1.3.24`, `stable-v1.3.23`, `stable-v1.3.22`, `stable-v1.3.13`)
- **ระบบ Cloud หลัก:** Firebase Realtime Database (RTDB) โปรเจกต์ `boss-timel2m`
- **ระบบ Cloud สำรองคู่ขนาน:** Google Sheets + Google Apps Script Web App (Parallel Mirror & Instant Failover)

```mermaid
flowchart TD
    Client["Browser / Client (Multiple Screens)"]
    Server["Express Server (Vercel Serverless / Node)"]
    Firebase[("Firebase RTDB (Primary Cloud)")]
    GoogleSheets[("Google Sheets (Parallel Mirror / Failover)")]
    LocalStore[("Local Memory Cache")]

    Client -->|/poll & Mutations| Server
    Server -->|Atomic Revision Write| Firebase
    Server -.->|Async Queue Mirror (Mutations Only)| GoogleSheets
    Server <--> LocalStore

    Firebase -.->|Quota Exceeded / Offline| FailoverTrigger["Auto Failover"]
    FailoverTrigger -->|db.getActiveSource() -> 'google-sheets'| GoogleSheets
```

---

## 🗂️ 2. แผนผังไฟล์สำคัญ (Where is What?)

| ไฟล์ / โฟลเดอร์ | หน้าที่หลัก | สิ่งที่ต้องระวัง |
| :--- | :--- | :--- |
| `server/server.js` | จุดรวม Router, Authentication, Inertia HTML dispatcher, Top bar badge UI, Polling endpoint, Boss Color API | ห้ามแก้กลไกเซสชัน 30 วัน และห้ามฮาร์ดโค้ดรหัสผ่าน |
| `server/db.js` | จัดการข้อมูลบอส/อีเวนต์, คำนวณรอบเกิด 5 นาที NOW, สีตัวอักษรบอส, ตัดสินแหล่งข้อมูล `getActiveSource()` | ห้ามยิง Cloud รายวินาที, การคำนวณถอยหลังต้องเป็น Local |
| `server/firebase.js` | เชื่อมต่อ Firebase RTDB, Atomic revision increment (`tracker/meta/dataRevision`) | ห้ามลบคีย์ลับ และห้าม expose error ดิบให้ไคลเอนต์ |
| `server/google-sheets.js` | Adapter ซิงค์คู่ขนานไปยัง Google Apps Script, Queue อัตโนมัติ, ระบบ Failover | สัญญา Zero Countdown Traffic: ห้ามส่ง tick/countdown เด็ดขาด |
| `google_apps_script/Code.gs` | สคริปต์ Google Apps Script Web App รับ Mutation แยกแท็บ Bosses (มีคอลัมน์ Color), Events, Settings, Log | ติดตั้งใน Google Sheet เป็น Web App (Access: Anyone) |
| `server/routes/settings.js` | API จัดการรหัสผ่าน, PIN ยืนยัน Google Sheets, ไอดีชั่วคราว (Guest) | บังคับใช้ `requireAdmin` ทุก Endpoint |
| `public/js/admin.js` | โมดอล Add Boss / Edit Boss สำหรับ Admin รองรับการกำหนดสีฟอนต์บอส | รองรับฟิลด์ `color` ส่งไปยัง Backend |
| `public/js/realtime-alerts.js` | จัดการ UI ในเบราว์เซอร์: Color Picker ในโมดอล, สลับสีชื่อบอสบนตาราง, Tooltip บอลลูนสีส้ม, สลับภาษา EN/TH, เสียงแจ้งเตือน, Revision guard | **ห้ามแก้ชื่อบอสเด็ดขาด**, ชื่อบอสต้องเป็นภาษาอังกฤษเสมอ |
| `test/boss-timer.test.js` | ชุดทดสอบลอจิกเวลาบอส (Unset, 5-minute NOW, Still Alive, Catch-up) | รัน `npm test` ต้องผ่าน 100% เสมอ |
| `test/parallel-sheets-and-guest.test.js` | ชุดทดสอบระบบ Google Sheets, Guest Passwords, Active Source, Dual-Language | รัน `npm test` ต้องผ่าน 100% เสมอ |
| `test/boss-color.test.js` | ชุดทดสอบระบบเปลี่ยนสีฟอนต์บอส (CRUD, Default Null, Countdown Immunity) | รัน `npm test` ต้องผ่าน 100% เสมอ |
| `server/data/store.json` | ⚠️ **ไฟล์ข้อมูล Local ของผู้ใช้** | **ห้ามคอมมิต ห้ามรีเซ็ต ห้ามเขียนทับข้อมูลจริงของโปรดักชัน** |

---

## ⚙️ 3. กลไกหลักที่ระบบทำงาน (Core Mechanisms)

### 3.1 ลอจิกเวลาเกิดบอส (Boss Timer Contract)
1. **Unset:** บอสที่ยังไม่บันทึกเวลาจะไม่นับถอยหลัง
2. **NOW 5 นาที:** เมื่อถึงเวลาเกิด บอสจะเด้งขึ้นบนสุดและแสดง `NOW` เป็นเวลา 5 นาทีพอดี
3. **Auto-Advance:** หากพ้น 5 นาทีโดยไม่มีการบันทึกเวลาใหม่ ระบบจะใช้เวลาเกิดรอบนั้นเป็นเวลาตายและคำนวณรอบถัดไปให้อัตโนมัติ
4. **Still Alive:** ปุ่มตรึงสถานะ `NOW` ค้างไว้จนกว่า Admin จะมากดอัปเดต
5. **No Per-Second Cloud Hits:** การนับถอยหลัง 1 วินาทีคำนวณในเบราว์เซอร์โดยใช้ Server Clock Offset

### 3.2 ฐานข้อมูลคู่ขนาน & Auto-Failover (Google Sheets)
1. **Mirror:** เมื่อมีการแก้ไขข้อมูลบอส/อีเวนต์ ระบบจะส่งข้อมูลไปบันทึกลง Google Sheets แบบ Asynchronous Queue ทันที
2. **Failover:** หาก Firebase เกิดปัญหา (เช่น Quota Exceeded 429 หรือตัดการเชื่อมต่อ) `db.getActiveSource()` จะเปลี่ยนเป็น `'google-sheets'` ทันที และเบราว์เซอร์จะแสดงป้าย `📊 Google Sheets`
3. **PIN ป้องกัน:** แท็บการตั้งค่า Google Sheets ล็อกด้วย PIN: `0386231334`

### 3.3 แหล่งข้อมูลจริง (Active Data Source Indicator)
- **Top Badge:**
  - `☁️ Firebase Live` (สีเขียว emerald) = กำลังใช้ Firebase ปกติ
  - `📊 Google Sheets` (สีเขียวมรกต) = Firebase มีปัญหา ระบบสลับมาดึงข้อมูลจาก Google Sheets
  - `💾 Local Mode` = ทำงานออฟไลน์
- **เมื่อคลิกที่ Badge:** จะมีหน้าต่าง Alert แสดงรายละเอียดสถานะของทั้ง Firebase และ Google Sheets แบบสมบูรณ์ (รองรับทั้งภาษาไทยและอังกฤษ)

### 3.4 สิทธิ์ผู้ใช้ 3 ระดับ (Role Isolation)
1. **Admin:** ควบคุมได้ทุกอย่าง, เข้าถึงปุ่มเฟืองการตั้งค่าระบบ 3 แท็บ (รหัสผ่าน, Guest, Google Sheets)
2. **Member:** ดูตารางบอสและรับเสียงเตือนได้เท่านั้น, ปรับระดับเสียง/เปลี่ยนธีมเฉพาะเครื่องตัวเองได้
3. **Guest (ไอดีชั่วคราว):** Admin ออกรหัสชั่วคราวพร้อมกำหนดชั่วโมงหมดอายุ (เช่น 24 ชม.), มีสิทธิ์เท่า Member, แสดงป้ายสีม่วง `🎟️ GUEST`

### 3.5 ระบบ 2 ภาษา และ Tooltip หนึ่งเดียว (Unified UI)
1. **Default English:** ภาษาเริ่มต้นของระบบคือภาษาอังกฤษ (EN) สลับเป็นไทยได้ที่ปุ่ม `🌐 EN / 🌐 TH` บนแถบขวาบน
2. **ชื่อบอสคงเดิม:** ชื่อบอสทุกตัวห้ามแปลเป็นภาษาไทยเด็ดขาด
3. **Unified Tooltip (Style #1):** Tooltip ทุกจุดในระบบเป็นบอลลูนสีส้มเข้ม (Amber-600) มีลูกศรชี้ ไม่ใช้ Tooltip สีขาวเดิมของ OS

### 3.6 ระบบปรับแต่งสีฟอนต์ชื่อบอสรายตัว (Custom Boss Font Color System)
1. **Admin Color Selection:** ในหน้าต่างโมดอล Add Boss และ Edit Boss จะมีแถบเลือกสีชื่อบอส (Palette 9 สีพรีเซ็ต + Custom Color Picker + ปุ่ม Default) พร้อมกล่อง Preview สด
2. **Realtime Sync:** เมื่อบันทึก สีฟอนต์จะซิงค์ลง Firebase RTDB, Google Sheets (คอลัมน์ `Color`), และ Local Memory Cache ทันที
3. **Zero Network & React Conflict-Free Rendering:** ในตารางบอส ฟังก์ชัน `reconcileBossRows()` จะนำค่าสีมาประยุกต์ใช้กับช่องชื่อบอสพร้อมเอฟเฟกต์เรืองแสง (`text-shadow`) โดยอัตโนมัติ โดยไม่ไปกวนการ Render ของ React และไม่มี Network request เพิ่มเติมแม้แต่ตัวเดียว

---

## 🛠️ 4. แนวทางการทำงานต่อ (Recipes for Common Tasks)

### 4.1 ต้องการเพิ่ม/แก้บอสใหม่ หรือเปลี่ยนสีชื่อบอส
- เข้าผ่านหน้าเว็บด้วยสิทธิ์ **Admin** -> กดปุ่ม Add Boss หรือ Edit Boss ในหน้า Dashboard
- เลือกสีฟอนต์ที่ต้องการ หรือคลิกกล่องสีเพื่อเลือกสีแบบ Custom
- ข้อมูลและสีจะซิงค์ลงทั้ง Firebase และ Google Sheets อัตโนมัติ

### 4.2 ต้องการแก้คำแปลหรือข้อความในหน้าเว็บ
- เปิดไฟล์ `public/js/realtime-alerts.js`
- ค้นหา Object `I18N` ที่บรรทัด ~100
- เพิ่ม/แก้ไขคู่คำแปลใน `I18N.en` และ `I18N.th`

### 4.3 ต้องการรันเทสเพื่อตรวจสอบความถูกต้อง
```bash
npm test
```
*(ต้องผ่านครบทั้ง 19 เทสเสมอ)*

### 4.4 ต้องการสำรองข้อมูลก่อนแก้ไขงานใหญ่
```bash
npm run backup
```
*(ไฟล์แบ็คอัพจะถูกบันทึกไว้ในโฟลเดอร์ `backups/` โดยอัตโนมัติ)*

---

## 🚫 5. ข้อห้ามเด็ดขาด (Golden Rules)

1. ❌ **ห้ามคอมมิตไฟล์ `server/data/store.json` หรือรหัสผ่านลง Git**
2. ❌ **ห้ามยิง Request ไป Firebase หรือ Google Sheets ทุกวินาที** (ต้องใช้ Local Timer เสมอ)
3. ❌ **ห้ามแปลชื่อบอส** (เช่น ห้ามแปล Antharas, Baium เป็นภาษาไทย)
4. ❌ **ห้ามลบ Recovery Tags** (`stable-v1.3.27`, `stable-v1.3.26`, `stable-v1.3.25`, `stable-v1.3.24`, `stable-v1.3.23`, `stable-v1.3.22`, `stable-v1.3.13`)

