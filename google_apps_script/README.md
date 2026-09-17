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
