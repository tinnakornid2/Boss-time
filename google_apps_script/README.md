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
