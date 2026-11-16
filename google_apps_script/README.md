# 📑 คู่มือการติดตั้ง Google Apps Script Parallel Database

## 1. สร้าง Google Spreadsheet
1. ไปที่ [Google Drive](https://drive.google.com)
2. กด **+ New** (สร้างใหม่) -> **Google Sheets** (กูเกิล สเปรดชีต)
3. ตั้งชื่อไฟล์ เช่น `L2-BossTracker-Parallel-DB`

## 2. นำโค้ด Code.gs ไปใส่
1. ที่หน้า Google Sheets ไปที่เมนูด้านบนเลือก **Extensions** (ส่วนขยาย) -> **Apps Script**
2. ลบโค้ดเริ่มต้นออก แล้วคัดลอกเนื้อหาทั้งหมดจากไฟล์ [Code.gs](file:///d:/Anti%20bosstime/google_apps_script/Code.gs) ไปวาง
3. ตรวจสอบค่า `SECRET_TOKEN` ที่บรรทัด 25 (ค่าเริ่มต้นคือ `boss-parallel-secret-777999`)
4. กดไอคอน **💾 Save project** (Ctrl + S)

## 3. Deploy เป็น Web App
1. กดปุ่มสีน้ำเงิน **Deploy** (ทำให้ใช้งานได้) ที่มุมขวาบน -> เลือก **New deployment** (การทำให้ใช้งานได้ใหม่)
2. กดไอคอนฟันเฟือง ⚙️ ข้าง "Select type" -> เลือก **Web app**
3. ตั้งค่าดังนี้:
   - **Description**: `Boss Tracker DB`
   - **Execute as**: `Me (ฉัน)`
   - **Who has access**: `Anyone (ทุกคน)` *(สำคัญมาก: เพื่อให้ Node.js Server ยิงเข้ามาได้)*
4. กดปุ่ม **Deploy**
5. หาก Google แจ้งขอสิทธิ์การเข้าถึง (Authorization Required):
   - กด **Authorize access** -> เลือกบัญชี Google ของคุณ
   - กด **Advanced** (ขั้นสูง) -> กด **Go to ... (unsafe)**
   - กด **Allow** (อนุญาต)
6. ระบบจะแสดงหน้าต่างพร้อม **Web app URL** (ตัวอย่าง: `https://script.google.com/macros/s/AKfycb.../exec`)
7. คัดลอก URL นี้ นำไปกรอกในหน้าตั้งค่า **Google Sheets** ของระบบ Boss Tracker!

## 4. ตัวตั้งเวลาแจ้งเตือนบนมือถือ (Web Push) ทุก 1 นาที

Google จะเรียก `POST /api/push/tick` ของ Boss Tracker ทุก 1 นาที ให้ server ส่งแจ้งเตือนที่ถึงเวลา (ไม่อ่าน/เขียน Firebase เพิ่ม)

1. วางโค้ด `Code.gs` เวอร์ชันล่าสุด (มีฟังก์ชัน `pushTick`, `installPushTickTrigger`, `removePushTickTrigger` ท้ายไฟล์) แล้วกด Save
2. ไปที่ **Project Settings** (ไอคอนฟันเฟือง) → **Script Properties** → **Add script property** เพิ่ม 2 ค่า:
   - `PUSH_TICK_URL` = `https://boss-time-eloni.vercel.app/api/push/tick`
   - `PUSH_TICK_SECRET` = ค่าเดียวกับ `PUSH_TICK_SECRET` ที่ตั้งใน Vercel (ห้ามใส่ค่านี้ในโค้ด)
3. กลับไปหน้า Editor เลือกฟังก์ชัน **installPushTickTrigger** แล้วกด **Run** (ครั้งแรกจะขออนุญาต ให้กด Allow)
4. ตรวจได้ที่เมนู **Triggers** (ไอคอนนาฬิกา) จะเห็น `pushTick` ทำงานทุก 1 นาที และดูผลได้ที่ **Executions**
5. ถ้าต้องการหยุด: รันฟังก์ชัน **removePushTickTrigger**

หมายเหตุ: หลัง deploy ใหม่ อาจเห็น `HTTP 503` 1–2 ครั้ง (server กำลังโหลดข้อมูล) เป็นเรื่องปกติ รอบถัดไปจะทำงานเอง

## 5. รีพอทเวลาบอส (ปุ่ม Report → Export to Google Sheets)

Admin กด **📋 Report** → **📊 Export to Google Sheets** แล้ว server จะให้ Apps Script เขียนแท็บ **Boss Report** ในไฟล์นี้ (มีสี เส้นตาราง แยกบอสปกติ/อินเวชั่น) แล้วเปิดชีตให้เอง ไม่ต้องกด Ctrl+V

ต้องอัปเดต Apps Script **1 ครั้ง** (โค้ดเก่าไม่รู้จักคำสั่ง `write_report`):

1. เปิดไฟล์ Google Sheets ที่ใช้กับ Boss Tracker → **Extensions → Apps Script**
2. ลบโค้ดเดิมใน `Code.gs` แล้ววางโค้ด `Code.gs` เวอร์ชันล่าสุดทั้งไฟล์ → กด **Save** (Ctrl+S)
   - ถ้าเคยเปลี่ยน `SECRET_TOKEN` ไว้ ให้ใส่ค่าเดิมกลับเข้าไปก่อนกด Save
3. กด **Deploy → Manage deployments** → กดไอคอนดินสอ (Edit) ที่ deployment เดิม
4. ช่อง **Version** เลือก **New version** → กด **Deploy**
   - ใช้ deployment เดิม ลิงก์ Web app URL จะไม่เปลี่ยน ไม่ต้องแก้ค่าในเว็บ
   - ห้ามกด "New deployment" เพราะจะได้ URL ใหม่
5. ลองกด **Export to Google Sheets** ในเว็บ ถ้าขึ้นว่า "ต้องอัปเดต Apps Script" แปลว่ายังเป็นเวอร์ชันเก่า ให้ทำข้อ 3–4 อีกครั้ง

หมายเหตุ:
- แท็บ **Boss Report** จะถูกเขียนทับทุกครั้งที่กด ไม่แตะแท็บ Bosses / Events / Settings / Metadata
- Admin คนอื่นที่จะเปิดชีตนี้ได้ ต้องได้รับสิทธิ์ดูไฟล์ Google Sheets นี้ (ปุ่ม Share ใน Google Sheets)
- ถ้า Google Sheets ยังไม่ได้เชื่อม หรือเขียนไม่สำเร็จ หน้าต่างรีพอทจะมีปุ่ม "คัดลอกตาราง + เปิดชีตใหม่" ให้ใช้ Ctrl+V แทน

## 6. Log เวลาบอสตอนเที่ยงคืน (แท็บ Invasion Log)

ทุกเที่ยงคืน (เวลาไทย) หลังวัน **จันทร์ พุธ ศุกร์** ระบบจะบันทึกเวลาตาย/เวลาเกิดของบอสทุกตัว แยกตามเซิร์ฟเวอร์ (เซิร์ฟเวอร์หลัก และเซิร์ฟเวอร์อินเวชั่น) ลงแท็บ **Invasion Log** พร้อมวันที่ และลบแถวที่เก่ากว่า 30 วันออกเอง Admin ดูได้ที่ **📋 Report → 📜 Log**

- ใช้ตัวตั้งเวลา `pushTick` เดิม (หัวข้อ 4) และ Script Properties เดิม (`PUSH_TICK_URL`, `PUSH_TICK_SECRET`) ไม่ต้องตั้งค่าเพิ่ม
- ต้องวาง `Code.gs` เวอร์ชันล่าสุด แล้ว Deploy → Manage deployments → New version (แบบเดียวกับหัวข้อ 5)
- อยากลองบันทึกทันที: ในหน้า Editor เลือกฟังก์ชัน **runInvasionLogNow** แล้วกด **Run** (จะบันทึกเป็นวันที่ของวันนี้)
- ถ้าเที่ยงคืนเซิร์ฟเวอร์ยังไม่พร้อม ระบบจะลองใหม่ทุกนาทีจนถึง 00:59 และบันทึกคืนละครั้งเดียว
- เซิร์ฟเวอร์หลักบันทึกเป็น `Main` (ไม่ผูกกับชื่อเซิร์ฟเวอร์ ย้ายเซิร์ฟก็ไม่กระทบ) ส่วนเซิร์ฟเวอร์อินเวชั่นบันทึกตาม Badge label ของคืนนั้น
- คอลัมน์ที่ซ่อนไว้ (ts, kind, id, killIso, spawnIso, statusKey) ใช้สำหรับลบข้อมูลเก่าและนำเข้าเวลา ห้ามลบหรือแก้
- Admin เลือกวันในปฏิทินของแท็บ 📜 Log แล้วกด **นำเข้าเวลาชุดนี้** ที่ตารางเซิร์ฟเวอร์อินเวชั่น เพื่อเอาเวลาคืนนั้นกลับมาใช้กับบอสอินเวชั่น (ระบบถามยืนยันก่อน)
- **หลังบันทึก log ตอนเที่ยงคืน** ระบบจะ **ซ่อนบอสอินเวชั่นบนหน้าเว็บ และล้างเวลาบอสอินเวชั่นทั้งหมด** จนกว่า Admin จะกดแสดงอินเวชั่นอีกครั้ง **บอสปกติไม่ถูกแตะ** (ทำเฉพาะรอบเที่ยงคืนอัตโนมัติ ไม่ทำตอนกด runInvasionLogNow และทำหลังบันทึก log สำเร็จแล้วเท่านั้น)
