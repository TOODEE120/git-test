// dashboard-app.js
let selectedStudentUID = null;
let currentView = 'dashboard';
let isInitialLoad = true; // สำหรับป้องกันการแจ้งเตือนรัวๆ ตอนโหลดหน้าครั้งแรก
let updateScheduled = false; // ป้องกันการอัปเดต UI ซ้ำซ้อนในเฟรมเดียวกัน
let lastViolationCount = {}; // จำจำนวนการทำผิดล่าสุดเพื่อแจ้งเตือน

// รายการโจทย์ข้อสอบ (ดึงมาจาก index.html)
let EXAM_QUESTIONS = [];
let ANSWER_KEY = [];

document.addEventListener('DOMContentLoaded', async () => {
    await fetchExamConfig(); // รอโหลดข้อมูล API ให้เสร็จก่อนเริ่มระบบ
    init();
});

async function fetchExamConfig() {
    try {
        // const response = await fetch('https://api.yourdomain.com/exam-config');
        // const data = await response.json();
        
        // จำลองข้อมูลจาก API
        const data = [
            { text: "ภาษา HTML ใช้ทำอะไร?", correct: "B" },
            { text: "CSS มีหน้าที่อะไร?", correct: "A" },
            { text: "JavaScript ใช้ในการทำอะไร?", correct: "A" },
            { text: "ตัวแปร (Variable) คืออะไร?", correct: "A" },
            { text: "Loop ใช้สำหรับการทำอะไร?", correct: "A" },
            { text: "Function มีประโยชน์อะไร?", correct: "A" },
            { text: "Database ใช้เพื่อการอะไร?", correct: "B" },
            { text: "API ในการเขียนโปรแกรมคืออะไร?", correct: "A" }
        ];
        
        EXAM_QUESTIONS = data.map(q => q.text);
        ANSWER_KEY = data.map(q => q.correct);
    } catch (e) { console.error("Failed to load exam API", e); }
}

function init() {
    // บังคับซ่อนกรอบ "สถิติเวลาตอบแต่ละข้อ" อัตโนมัติ (กรณีที่ยังไม่ได้ลบโค้ดออกจาก HTML)
    const timeChartEl = document.getElementById('timeChart');
    if (timeChartEl && timeChartEl.parentElement) {
        timeChartEl.parentElement.style.display = 'none';
    }

    updateDashboard();
    
    // ปรับปรุงการดักฟังเหตุการณ์ให้ทำงานทันใจผ่าน requestAnimationFrame (Real-time 60FPS)
    window.addEventListener('storage', (e) => {
        if (!e.key) return;
        if (e.key.startsWith('mattep_live_user_') || e.key === 'mattep_live_sync_trigger' || e.key === 'mattepExamRecords') {
            if (!updateScheduled) {
                updateScheduled = true;
                requestAnimationFrame(() => {
                    updateDashboard();
                    updateScheduled = false;
                });
            }
        }
    });

    // ปรับรอบการดึงข้อมูลสำรองให้เร็วขึ้นเป็นทุก 1 วินาที เพื่อความสดใหม่
    setInterval(updateDashboard, 1000);

    setInterval(() => {
        const now = new Date();
        document.getElementById('timer').textContent = now.toLocaleTimeString('th-TH');
    }, 1000);
}

function getScoreValue(s) {
    // รองรับทั้งโครงสร้าง Live และ Record ที่ส่งมาคนละชื่อ
    return Math.round(s.suspicionScore || s.antiCheat?.suspicionScore || s.antiCheatReport?.suspicionScore || 0);
}

function updateDashboard() {
    // ดึงข้อมูล Live จากทุุกคีย์ที่ขึ้นต้นด้วย mattep_live_user_
    const liveStudents = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('mattep_live_user_')) {
            try {
                liveStudents.push(JSON.parse(localStorage.getItem(key)));
            } catch(e) {}
        }
    }

    const finishedData = JSON.parse(localStorage.getItem('mattepExamRecords') || '[]');

    // ใช้ Map เพื่อป้องกันข้อมูลนักเรียนซ้ำซ้อน (กรณี Live กับ Finished ชนกัน)
    // และทำให้มั่นใจว่าข้อมูลเป็นของใครของมันจริงๆ
    const studentMap = new Map();

    // 1. ประมวลผลคนที่สอบเสร็จแล้วก่อน (สถานะสุดท้าย)
    finishedData.forEach(item => {
        const uid = item.uid || ('f-' + item.studentNo + '-' + item.name); // fallback สำหรับข้อมูลเก่า
        studentMap.set(uid, {
            ...item,
            uid: uid,
            status: 'finished',
            no: item.studentNo,
            risk: getScoreValue(item),
            sortTime: item.submitTimestamp || 0
        });
    });

    // 2. ประมวลผลคนที่กำลังสอบ (Live) โดยจะเพิ่มเข้าไปก็ต่อเมื่อยังไม่มีใน Map (ยังไม่สอบเสร็จ)
    liveStudents.forEach(item => {
        if (!studentMap.has(item.uid)) {
            studentMap.set(item.uid, {
                ...item,
                uid: item.uid,
                status: 'live',
                no: item.no,
                risk: getScoreValue(item),
                sortTime: item.lastUpdate || Date.now()
            });
        }
        // ตรวจสอบพฤติกรรมใหม่เพื่อแสดง Toast
        checkNewViolations(item);
    });

    const allStudents = Array.from(studentMap.values());

    analyzeAnomalies(allStudents); // ประมวลผลพฤติกรรมผิดปกติด้วยสถิติ
    updateSummaryStats(allStudents);
    renderStudentList(allStudents);
    
    // อัปเดตเวลาการ Sync ล่าสุดบน UI
    const syncTimeEl = document.getElementById('syncTimeText');
    if (syncTimeEl) syncTimeEl.textContent = new Date().toLocaleTimeString('th-TH', { hour12: false });
    
    if (selectedStudentUID) updateDetailView(allStudents);
    isInitialLoad = false; // ปลดล็อกให้แสดงแจ้งเตือนได้หลังจากโหลดข้อมูลรอบแรกเสร็จ
}

function analyzeAnomalies(students) {
    const finished = students.filter(s => s.status === 'finished');
    if (finished.length < 3) return; // ต้องมีข้อมูลห้องอย่างน้อย 3 คนเพื่อหา Base ค่าเฉลี่ย

    // หา Mean และ SD ของ "เวลาทำข้อสอบ"
    const times = finished.map(s => s.antiCheatReport?.runtime?.ms || 0).filter(t => t > 0);
    const meanTime = times.reduce((a, b) => a + b, 0) / times.length;
    const stdTime = Math.sqrt(times.reduce((a, b) => a + Math.pow(b - meanTime, 2), 0) / times.length) || 1;

    // หา Mean และ SD ของ "ความถี่การหันหน้า/ชำเลืองตา"
    const gazeCounts = finished.map(s => s.antiCheatReport?.statistics?.aiDetection || 0);
    const meanGaze = gazeCounts.reduce((a, b) => a + b, 0) / gazeCounts.length;
    const stdGaze = Math.sqrt(gazeCounts.reduce((a, b) => a + Math.pow(b - meanGaze, 2), 0) / gazeCounts.length) || 1;

    finished.forEach(s => {
        const report = s.antiCheatReport;
        if (!report || s.anomalyProcessed) return;
        
        let anomalyScore = 0;
        let reasons = [];

        const zTime = ((report.runtime?.ms || 0) - meanTime) / stdTime;
        if (zTime < -2.5) { anomalyScore += 30; reasons.push(`ทำข้อสอบเร็วผิดปกติ (Z-Score: ${zTime.toFixed(2)})`); }

        const zGaze = ((report.statistics?.aiDetection || 0) - meanGaze) / stdGaze;
        // เอาการเพิ่มคะแนนจากการหันหน้า/ชำเลืองตาออก (+0)
        if (zGaze > 2.5) { anomalyScore += 0; reasons.push(`ความถี่การหันหน้าสูงกว่าเพื่อนในห้อง`); }

        if (anomalyScore > 0) {
            s.risk = Math.min(100, s.risk + anomalyScore);
            s.anomalyProcessed = true;
            // บันทึกลง Event Log ทันที
            report.violations.push({ description: "ตรวจพบความผิดปกติทางสถิติ (Anomaly)", category: "System Anomaly", time: new Date().toLocaleTimeString('th-TH'), points: anomalyScore, details: reasons.join(", ") });
        }
    });
}

function updateSummaryStats(students) {
    const total = students.length;
    const finished = students.filter(s => s.status === 'finished');
    const highRisk = students.filter(s => s.risk > 60).length;
    
    // คำนวณคะแนนเฉลี่ย (เฉพาะคนส่งแล้ว)
    let avgScore = 0;
    if (finished.length > 0) {
        const sum = finished.reduce((acc, curr) => acc + (curr.score || 0), 0);
        avgScore = (sum / finished.length).toFixed(1);
    }

    // คำนวณความเสี่ยงเฉลี่ย
    const avgRisk = total > 0 
        ? Math.round(students.reduce((acc, curr) => acc + curr.risk, 0) / total) 
        : 0;

    // อัปเดตตัวเลขและสีสถานะ (ถ้าไม่มีคนสอบให้เป็นสีเทา)
    const updateStat = (id, val) => {
        const el = document.getElementById(id);
        const card = el.closest('.bg-white');
        const oldVal = el.textContent;
        el.textContent = val;

        if (total > 0) {
            el.classList.remove('text-slate-300');
            el.classList.add('text-rose-500');
        } else {
            el.classList.replace('text-rose-500', 'text-slate-300');
        }
    };

    updateStat('totalStudents', total);
    updateStat('avgScore', avgScore);
    updateStat('avgRisk', avgRisk);
    updateStat('riskHigh', highRisk);

    const studentCountEl = document.getElementById('studentCount');
    if (studentCountEl.textContent !== String(total)) studentCountEl.textContent = total;

    // อัปเดต Progress Bars
    const lowCount = students.filter(s => s.risk <= 30).length;
    const medCount = students.filter(s => s.risk > 30 && s.risk <= 60).length;

    const updateBar = (id, count) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const el = document.getElementById(id);
        const newText = pct > 15 ? `${count} คน (${pct}%)` : (count > 0 ? count : '');
        
        if (el.style.width !== pct + '%') el.style.width = pct + '%';
        if (el.textContent !== newText) el.textContent = newText;
    };

    updateBar('riskLowBar', lowCount);
    updateBar('riskMediumBar', medCount);
    updateBar('riskHighBar', highRisk);

    // จัดการ "จุดสี" การกระจายความเสี่ยง (ถ้าไม่มีคนสอบให้จางลง)
    document.querySelectorAll('.risk-dot').forEach(dot => {
        dot.classList.toggle('grayscale', total === 0);
        dot.classList.toggle('opacity-30', total === 0);
    });
    
    // วิเคราะห์ข้อสอบ
    renderQuestionAnalysis(finished);
}

function renderQuestionAnalysis(finishedStudents) {
    const correctEl = document.getElementById('mostCorrectQuestions');
    const wrongEl = document.getElementById('mostWrongQuestions');

    const emptyPlaceholder = '<div class="text-xs text-slate-300 italic py-2">ยังไม่มีข้อมูลการส่งข้อสอบ</div>';
    const noDataPlaceholder = '<div class="text-xs text-slate-300 italic py-2">ไม่มีข้อมูล</div>';

    if (finishedStudents.length === 0) {
        correctEl.innerHTML = emptyPlaceholder;
        wrongEl.innerHTML = emptyPlaceholder;
        return;
    }
    
    let correctCount = Array(EXAM_QUESTIONS.length).fill(0);
    let wrongCount = Array(EXAM_QUESTIONS.length).fill(0);
    
    finishedStudents.forEach(s => {
        if (s.objectiveAnswers) {
            s.objectiveAnswers.forEach((val, idx) => { 
                if (val === 1) {
                    correctCount[idx]++; 
                } else {
                    wrongCount[idx]++;
                }
            });
        }
    });

    // กรองเฉพาะข้อที่มีคนตอบถูก/ผิด มากกว่า 0 คน และเรียงลำดับจากมากไปน้อย
    const correctStats = correctCount.map((count, i) => ({ q: i + 1, count })).filter(item => item.count > 0).sort((a, b) => b.count - a.count);
    const wrongStats = wrongCount.map((count, i) => ({ q: i + 1, count })).filter(item => item.count > 0).sort((a, b) => b.count - a.count);
    
    const renderItem = (item) => `
        <div onclick="showQuestionDetail(${item.q})" class="flex justify-between items-center py-2 border-b border-slate-50 hover:bg-rose-50/30 cursor-pointer transition-all px-1 rounded group">
            <div class="flex flex-col overflow-hidden">
                <span class="text-xs font-bold text-slate-500">ข้อที่ ${item.q}</span>
                <span class="text-[13px] text-slate-700 truncate w-full pr-4">${EXAM_QUESTIONS[item.q-1]}</span>
            </div>
            <span class="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">${item.count} คน</span>
        </div>
    `;

    correctEl.innerHTML = correctStats.length > 0 ? correctStats.slice(0, 3).map(renderItem).join('') : noDataPlaceholder;
    wrongEl.innerHTML = wrongStats.length > 0 ? wrongStats.slice(0, 3).map(renderItem).join('') : noDataPlaceholder;
}

function renderStudentList(students) {
    const list = document.getElementById('studentList');
    const search = document.getElementById('searchInput').value.toLowerCase();
    const filter = document.getElementById('riskFilter').value;

    const newListHTML = students
        .filter(s => {
            const matchSearch = (s.name || '').toLowerCase().includes(search) || (s.no || '').includes(search);
            if (filter === 'high') return matchSearch && s.risk > 60;
            if (filter === 'medium') return matchSearch && s.risk > 30 && s.risk <= 60;
            if (filter === 'low') return matchSearch && s.risk <= 30;
            return matchSearch;
        })
        .sort((a, b) => {
            // 1. คนที่สอบเสร็จ (finished) อยู่บนสุด
            if (a.status !== b.status) {
                return a.status === 'finished' ? -1 : 1;
            }
            // 2. ในกลุ่มที่สอบเสร็จ เรียงตามเวลาที่เสร็จ (ใครเสร็จก่อนขึ้นก่อน - น้อยไปมาก)
            if (a.status === 'finished') {
                return a.sortTime - b.sortTime;
            }
            // 3. ในกลุ่มที่กำลังทำ เรียงตามความเสี่ยง (เสี่ยงสูงขึ้นก่อน)
            return b.risk - a.risk;
        })
        .map((s) => `
            <div onclick="selectStudent('${s.uid}')" 
                 class="p-3.5 mb-2 rounded-2xl border transition-all duration-300 cursor-pointer group 
                        ${selectedStudentUID === s.uid 
                          ? 'bg-rose-50/90 border-rose-300 shadow-sm translate-x-1' 
                          : 'bg-white/40 backdrop-blur-md border-rose-100/40 hover:bg-white/80 hover:border-rose-200 hover:translate-x-1 shadow-sm'}">
                <div class="flex justify-between items-start mb-1.5">
                    <div class="font-medium text-slate-800 truncate pr-2 text-sm">
                        ${s.name || 'ไม่ระบุชื่อ'} <span class="hidden">${s.uid}</span>
                    </div>
                    ${s.status === 'live' 
                        ? `
                        <span class="flex items-center gap-1.5 bg-amber-50 text-amber-600 border border-amber-200/30 text-[9px] px-2 py-0.5 rounded-full font-bold animate-pulse">
                            <span class="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                            กำลังสอบ
                        </span>`
                        : `
                        <span class="flex items-center gap-1 bg-emerald-50 text-emerald-600 border border-emerald-200/30 text-[9px] px-2 py-0.5 rounded-full font-bold">
                            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                            ส่งแล้ว
                        </span>`}
                </div>
                <div class="flex justify-between items-center w-full mt-2">
                    <div class="flex items-center gap-2">
                        <span class="flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-medium border border-slate-200" title="เลขที่">
                            <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path></svg>
                            ${s.no}
                        </span>
                        <span class="flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-medium border border-slate-200" title="ห้อง">
                            <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                            ${s.class || s.studentClass || '-'}
                        </span>
                    </div>
                    <div class="flex items-center gap-1.5 font-bold ${s.risk > 60 ? 'text-rose-500' : s.risk > 30 ? 'text-amber-500' : 'text-emerald-500'}">
                        <span class="text-[9px] uppercase opacity-40 tracking-wider">Risk</span>
                        <span class="text-xs font-black">${s.risk}</span>
                    </div>
                </div>
            </div>
        `).join('');

    // Smart Render: อัปเดต HTML เฉพาะเมื่อมีการเปลี่ยนแปลงข้อมูลจริงๆ 
    // เพื่อป้องกันรายชื่อ "เด้ง" หรือ "กระพริบ" ทุกครั้งที่ Sync
    if (list.innerHTML !== newListHTML) {
        list.innerHTML = newListHTML;
    }
}

function selectStudent(uid) {
    selectedStudentUID = uid;
    document.getElementById('dashboardView').classList.add('hidden-view');
    document.getElementById('studentDetailView').classList.remove('hidden-view');
    document.getElementById('backButton').classList.remove('hidden-view');
    updateDashboard();
}

function showDashboard() {
    selectedStudentUID = null;
    currentView = 'dashboard';
    document.getElementById('studentDetailView').classList.add('hidden-view');
    document.getElementById('dashboardView').classList.remove('hidden-view');
    document.getElementById('backButton').classList.add('hidden-view');
    updateDashboard();
}

function updateDetailView(students) {
    const s = students.find(st => st.uid === selectedStudentUID);
    if (!s) return;

    const displayName = s.name || 'ไม่ระบุชื่อ';
    document.getElementById('detailNameTitle').innerHTML = `${displayName} <span class="hidden">${s.uid}</span>`;
    document.getElementById('detailName').innerHTML = `${displayName} <span class="hidden">${s.uid}</span>`;
    document.getElementById('detailNo').textContent = s.no || '-';
    document.getElementById('detailClass').textContent = s.class || s.studentClass || '-';
    document.getElementById('detailScore').textContent = s.status === 'finished' ? `${s.score || 0}/${EXAM_QUESTIONS.length}` : '-';
    // แสดงคำตอบปรนัยแบบ Real-time
    const objGrid = document.getElementById('liveObjectiveGrid');
    const objAnswers = s.objectiveAnswers || [];
    objGrid.innerHTML = Array(EXAM_QUESTIONS.length).fill(0).map((_, i) => {
        const ans = objAnswers[i] || '-';
        const isSelected = ans !== '-';
        return `
            <div onclick="showQuestionDetail(${i+1})" class="cursor-pointer hover:scale-105 transition-transform flex flex-col items-center p-2 rounded-lg border ${isSelected ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'}">
                <span class="text-[9px] font-bold text-slate-400 mb-1">${i+1}</span>
                <span class="text-sm font-black ${isSelected ? 'text-rose-600' : 'text-slate-300'}">${ans}</span>
            </div>
        `;
    }).join('');

    // แสดงคำตอบอัตนัยแบบ Real-time
    document.getElementById('liveEssay1').textContent = s.essays?.essay1 || 'ยังไม่มีคำตอบ...';
    document.getElementById('liveEssay2').textContent = s.essays?.essay2 || 'ยังไม่มีคำตอบ...';

    const risk = s.risk || 0;
    const detailRisk = document.getElementById('detailRisk');
    detailRisk.textContent = risk;
    detailRisk.className = `text-3xl font-black ${risk > 60 ? 'text-rose-500' : risk > 30 ? 'text-amber-500' : 'text-emerald-500'}`;

    // รายการพฤติกรรมสรุป (Activity List)
    const activityList = document.getElementById('activityList');
    const violations = s.violations || s.antiCheat?.violations || s.antiCheatReport?.violations || [];
    if (violations.length > 0) {
        const summary = {};
        violations.forEach(v => { summary[v.category] = (summary[v.category] || 0) + 1; });
        activityList.innerHTML = Object.entries(summary).map(([cat, count]) => `
            <li class="flex justify-between items-center text-sm"><span class="text-slate-600">${cat}</span><span class="font-bold text-rose-500">${count} ครั้ง</span></li>
        `).join('');
    } else {
        activityList.innerHTML = '<li class="text-sm text-slate-400 italic">ไม่พบพฤติกรรมเสี่ยง</li>';
    }

    // สถิติ AI (Status List)
    const statusList = document.getElementById('statusList');
    const stats = s.statistics || s.antiCheat?.statistics || s.antiCheatReport?.statistics || {};
    const statusItems = [
        { label: 'สลับหน้าจอ (Tab Switch)', val: stats.tabSwitch || 0 },
        { label: 'วางข้อความ (Paste)', val: stats.paste || 0 },
        { label: 'พยายามเปิด DevTools', val: stats.devtools || 0 },
        { label: 'คัดลอกข้อสอบ (Copy)', val: stats.copy || 0 }
    ];
    statusList.innerHTML = statusItems.map(item => `
        <li class="flex justify-between items-center text-sm"><span class="text-slate-600">${item.label}</span><span class="font-bold ${item.val > 0 ? 'text-rose-500' : 'text-emerald-500'}">${item.val} ครั้ง</span></li>
    `).join('');

    // ลำดับเหตุการณ์ (Event List)
    const eventLogList = document.getElementById('eventList');
    if (violations.length > 0) {
        eventLogList.innerHTML = [...violations].reverse().map(v => `
            <li class="py-3 flex flex-col gap-2">
                <div class="flex justify-between items-start w-full">
                    <div class="pr-4">
                        <div class="text-sm font-bold text-slate-800">${v.description}</div>
                        <div class="text-xs text-slate-500">${v.time || ''} • ${v.category}</div>
                    </div>
                    <span class="text-xs font-bold px-2 py-1 rounded ${v.points >= 25 ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}">+${v.points}</span>
                </div>
                ${v.image ? `
                <button onclick="showImageModal('${v.image}', '${v.description}', '${v.time || ''}')" class="mt-1 flex items-center gap-2 text-xs font-semibold bg-rose-50 text-rose-600 px-3 py-1.5 rounded-lg border border-rose-100 hover:bg-rose-100 transition-colors w-fit">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    คลิกดูรูปหลักฐาน
                </button>
                ` : ''}
            </li>
        `).join('');
    } else {
        eventLogList.innerHTML = '<li class="py-3 text-sm text-slate-400 italic text-center">ไม่มีเหตุการณ์ผิดปกติ</li>';
    }
}

// ฟังก์ชันสำหรับเปิดรูปหลักฐานด้วยหน้าต่าง Modal
function showImageModal(imgSrc, desc, time) {
    const modal = document.getElementById('evidenceModal');
    const content = document.getElementById('modalContentBlock');
    
    document.getElementById('modalTitle').textContent = 'หลักฐานการทุจริต';
    document.getElementById('modalDescription').innerHTML = desc;
    document.getElementById('modalTime').textContent = time;
    
    const imgContainer = document.getElementById('modalImage');
    imgContainer.style.display = 'flex';
    // เพิ่มฟังก์ชันคลิกเพื่อซูมขยายรูปภาพและจัดการ Cursor
    imgContainer.innerHTML = `<img src="${imgSrc}" style="cursor: zoom-in; max-height: 350px; transition: max-height 0.3s ease;" class="w-full h-auto object-contain rounded-xl shadow-md" onclick="this.style.maxHeight = this.style.maxHeight === '80vh' ? '350px' : '80vh'; this.style.cursor = this.style.cursor === 'zoom-out' ? 'zoom-in' : 'zoom-out';" title="คลิกเพื่อซูม" alt="หลักฐาน" />`;

    const wrongStudentsEl = document.getElementById('modalWrongStudents');
    if (wrongStudentsEl && wrongStudentsEl.parentElement) {
        wrongStudentsEl.parentElement.style.display = 'none'; // ซ่อนส่วนรายชื่อคนตอบผิดไปก่อน
    }

    modal.classList.remove('hidden-view');
    setTimeout(() => {
        content.classList.remove('scale-90', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function exportReport() { alert('ฟีเจอร์การส่งออก PDF กำลังอยู่ในการพัฒนา'); }
function clearAllData() { if (confirm('ล้างข้อมูลทั้งหมด?')) { localStorage.clear(); location.reload(); } }
function logout() { window.location.href = 'home.html'; }
function filterStudents() { updateDashboard(); }

// ฟังก์ชันสำหรับแจ้งเตือนแบบ Real-time Toast
function checkNewViolations(student) {
    const studentKey = student.uid;
    const violations = student.antiCheat?.violations || student.antiCheatReport?.violations || [];
    const currentCount = violations.length;

    // ถ้าเป็นการโหลดครั้งแรก ให้จำจำนวนไว้เฉยๆ ไม่ต้องแจ้งเตือน
    if (isInitialLoad) {
        lastViolationCount[studentKey] = currentCount;
        return;
    }
    
    // ถ้ามีเคสใหม่เพิ่มขึ้น ให้แสดง Toast
    if (currentCount > (lastViolationCount[studentKey] || 0)) {
        const newVio = violations[violations.length - 1];
        if (newVio) showLiveToast(student.name, newVio.description, student.no, student.uid);
    }
    lastViolationCount[studentKey] = currentCount;
}

function showLiveToast(name, desc, no, uid) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'bg-white border border-rose-100 shadow-2xl p-4 rounded-2xl mb-3 animate-slide-in-right flex gap-3 min-w-[300px] max-w-[350px] cursor-pointer hover:bg-rose-50 transition-all hover:scale-[1.02]';
    
    // เมื่อคลิกที่แจ้งเตือน จะพาไปดูหน้ารายละเอียดของนักเรียนคนนั้นทันที
    if (uid) {
        toast.onclick = () => {
            selectStudent(uid);
            toast.classList.add('animate-fade-out-right');
            setTimeout(() => toast.remove(), 300);
        };
    }

    toast.innerHTML = `
        <div class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-rose-100 text-rose-600 mt-0.5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        </div>
        <div class="flex flex-col w-full">
            <div class="flex justify-between items-start w-full mb-1">
                <span class="font-bold text-rose-600 text-sm">แจ้งเตือนทุจริต!</span>
                <span class="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">เมื่อครู่</span>
            </div>
            <div class="text-sm font-bold text-slate-800">${name || 'ไม่ระบุชื่อ'} <span class="text-xs text-slate-500 font-normal ml-1">(เลขที่ ${no || '-'})</span></div>
            <div class="text-xs text-slate-600 mt-1.5 bg-rose-50/50 p-2 rounded-lg border border-rose-100/50 leading-relaxed">${desc}</div>
            ${uid ? '<div class="text-[10px] text-rose-500 font-semibold mt-2 flex items-center gap-1 opacity-80"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg> คลิกเพื่อดูรายละเอียด</div>' : ''}
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('animate-fade-out-right');
            setTimeout(() => toast.remove(), 300);
        }
    }, 6000);
}

/**
 * แสดงรายละเอียดโจทย์ข้อสอบเมื่อคลิก
 */
function showQuestionDetail(qNum) {
    const text = EXAM_QUESTIONS[qNum - 1];
    const correctAns = ANSWER_KEY[qNum - 1];
    const modal = document.getElementById('evidenceModal');
    const content = document.getElementById('modalContentBlock');
    
    document.getElementById('modalTitle').textContent = `โจทย์ปรนัยข้อที่ ${qNum}`;
    document.getElementById('modalDescription').innerHTML = `${text}<br><br><span class="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg text-sm font-bold"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> เฉลย: ตัวเลือก ${correctAns}</span>`;
    document.getElementById('modalTime').textContent = "หมวด: ปรนัย";
    document.getElementById('modalImage').style.display = 'none'; // ซ่อนส่วนรูปภาพสำหรับโจทย์

    const records = JSON.parse(localStorage.getItem('mattepExamRecords') || '[]');
    const wrongStudents = records.filter(r => r.objectiveAnswers && r.objectiveAnswers[qNum - 1] === 0).map(r => `${r.name || 'ไม่ระบุชื่อ'} (เลขที่ ${r.studentNo || '-'})`);
    
    const wrongStudentsEl = document.getElementById('modalWrongStudents');
    if (wrongStudentsEl) {
        wrongStudentsEl.parentElement.style.display = 'flex'; // แสดงส่วนรายชื่อคนตอบผิดกลับมา
        if (wrongStudents.length > 0) {
            wrongStudentsEl.className = 'text-sm bg-rose-50 border border-rose-100 p-3 rounded-lg max-h-[120px] overflow-y-auto';
            wrongStudentsEl.innerHTML = `<ul class="list-disc pl-5 space-y-1 text-rose-600 font-medium">${wrongStudents.map(name => `<li>${name}</li>`).join('')}</ul>`;
        } else {
            wrongStudentsEl.className = 'text-sm bg-emerald-50 border border-emerald-100 p-3 rounded-lg max-h-[120px] overflow-y-auto text-center';
            wrongStudentsEl.innerHTML = '<div class="flex items-center justify-center gap-2 text-emerald-600 font-bold py-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ไม่มีนักเรียนที่ตอบผิด</div>';
        }
    }

    modal.classList.remove('hidden-view');
    setTimeout(() => {
        content.classList.remove('scale-90', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closeEvidenceModal() {
    const modal = document.getElementById('evidenceModal');
    const content = document.getElementById('modalContentBlock');
    content.classList.add('scale-90', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden-view');
        const imgContainer = document.getElementById('modalImage');
        imgContainer.style.display = 'flex'; // คืนค่าส่วนรูปภาพ
        imgContainer.innerHTML = '<svg class="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
    }, 300);
}