// Configs
let warningCount = 0;
let captureCount = 0; 
let maxWarnings = 1;

// ==========================================
// Anti-Cheat System
// ==========================================

// ดักจับเวลาพับจอ หรือสลับแท็บ
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        warningCount++;
        if (warningCount >= maxWarnings) {
            alert(`คุณทำผิดกฎ ${maxWarnings} ครั้ง ระบบกำลังบังคับส่งข้อสอบ...`);
            document.body.innerHTML = "<h1 style='color:red; text-align:center; margin-top:50px;'>ยุติการสอบ: คุณทำผิดกฎ</h1>";
        }
    }
});

// บล็อกคลิกขวา & คีย์ลัดก๊อปปี้
document.addEventListener('contextmenu', e => { e.preventDefault(); alert("ไม่อนุญาตให้คลิกขวา"); });
document.addEventListener('copy', e => { e.preventDefault(); alert("ไม่อนุญาตให้คัดลอก"); });
document.addEventListener('cut', e => e.preventDefault());
document.addEventListener('paste', e => { e.preventDefault(); alert("ไม่อนุญาตให้วางข้อความ"); });

// ดักจับคนพับหน้าจอ (โชว์จอดำ)
const blackScreen = document.getElementById('black-screen');
window.addEventListener('blur', () => { if (blackScreen) blackScreen.style.display = 'flex'; });
window.addEventListener('focus', () => { if (blackScreen) blackScreen.style.display = 'none'; });

// ดัก PrintScreen 
document.addEventListener('keyup', e => {
    if (e.key === 'PrintScreen') {
        captureCount++;
        navigator.clipboard.writeText('เนื้อหาสงวนสิทธิ์!'); // เคลียร์คลิปบอร์ดทิ้ง
        
        if (captureCount > 1) {
            if (blackScreen) blackScreen.style.display = 'flex';
            setTimeout(() => alert('ใช้โควต้าแคปจอเกินกำหนด'), 50);
        }
    }
});

// ==========================================
// Form UI Handlers
// ==========================================

// ฟังก์ชันเพิ่มตัวเลือกใหม่ (Creator View)
const addInputBtn = document.querySelector('.add-input');
const optionList = document.querySelector('.option-list');
const addOptionRow = document.querySelector('.add-option-row');

if (addInputBtn) {
    // --- 1. ระบบเพิ่มข้อ ---
    addInputBtn.addEventListener('click', () => {
        // นับจำนวนข้อที่มีอยู่ เพื่อรันเลขถัดไป
        const currentCount = optionList.querySelectorAll('.option-row:not(.add-option-row)').length;
        
        // เวลาสร้างแถวใหม่ ต้องฝังปุ่มกากบาทลงไปด้วย
        const newRow = document.createElement('div');
        newRow.className = 'option-row';
        newRow.innerHTML = `
            <div class="fake-radio"></div>
            <input type="text" class="option-input" value="ตัวเลือกที่ ${currentCount + 1}">
            <div class="delete-btn" title="นำออก">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="#5f6368"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path></svg>
            </div>
        `;

        // แทรกโค้ดเข้าไปก่อนแถวปุ่ม Add
        optionList.insertBefore(newRow, addOptionRow);

        // Auto-focus ให้พิมพ์ทับได้เลย
        const newInput = newRow.querySelector('.option-input');
        newInput.focus();
        newInput.select();
    });

    // --- 2. ระบบลบข้อ ---
    optionList.addEventListener('click', (e) => {
        // เช็กก่อนว่าที่คลิกเนี่ย ใช่ปุ่มกากบาทหรือเปล่า
        const deleteBtn = e.target.closest('.delete-btn');
        
        if (deleteBtn) { // ถ้าคลิกโดนปุ่มกากบาทจริงๆ ค่อยทำข้างในนี้
            
            // หาว่ากากบาทตัวที่กด มันอยู่บรรทัดไหน จะได้ลบถูกอัน
            const rowToRemove = deleteBtn.closest('.option-row');
            
            // นับจำนวนข้อ
            const currentOptionCount = optionList.querySelectorAll('.option-row:not(.add-option-row)').length;
            
            if (currentOptionCount > 1) {
                rowToRemove.remove(); // ลบแถวทิ้ง
            } else {
                alert("ไม่สามารถลบได้ต้องให้แถวมากกว่า 1 แถว");
            }
        }
    });
}
// ==========================================
// ระบบปุ่ม "เผยแพร่" (Publish Form)
// ==========================================
const publishBtn = document.getElementById('putlish-btn');

if(publishBtn){
    publishBtn.addEventListener('click',() =>{
        // เด้ง Alert แจ้งเตือนหล่อๆ ว่าเผยแพร่แล้ว
        alert('เผยแพร่เรียบร้อย');
    })
}