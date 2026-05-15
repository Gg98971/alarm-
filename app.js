document.addEventListener('DOMContentLoaded', () => {
    // --- IndexedDB Wrapper ---
    const DB_NAME = 'AlarmAudioDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'customAudio';

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function saveCustomAudio(id, blob) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(blob, id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async function getCustomAudio(id) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function deleteCustomAudio(id) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // --- Shared Helpers ---
    const DAY_MS = 24 * 60 * 60 * 1000;
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const timeZoneNameOverrides = {
        'Asia/Calcutta': 'Kolkata',
        'Etc/UTC': 'UTC'
    };

    function readStoredArray(key, fallback) {
        try {
            const stored = JSON.parse(localStorage.getItem(key));
            return Array.isArray(stored) ? stored : fallback;
        } catch (e) {
            console.warn(`Ignoring invalid ${key} data`, e);
            return fallback;
        }
    }

    function createTextElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text;
        return element;
    }

    function createIcon(iconName) {
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', iconName);
        return icon;
    }

    function setButtonIcon(button, iconName) {
        if (button) {
            button.replaceChildren(createIcon(iconName));
        }
    }

    function setLucideIcon(container, iconName) {
        if (!container || container.dataset.icon === iconName) return false;

        const currentIcon = container.querySelector('svg, i');
        const nextIcon = createIcon(iconName);
        if (currentIcon) {
            currentIcon.replaceWith(nextIcon);
        } else {
            container.prepend(nextIcon);
        }
        container.dataset.icon = iconName;
        return true;
    }

    function pluralize(count, singular, plural = `${singular}s`) {
        return count === 1 ? singular : plural;
    }

    function isValidTimeZone(timeZone) {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
            return true;
        } catch (e) {
            return false;
        }
    }

    function getTimeZoneParts(date, timeZone) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date);

        return parts.reduce((result, part) => {
            if (part.type !== 'literal') {
                result[part.type] = Number(part.value);
            }
            return result;
        }, {});
    }

    function getTimeZoneOffsetMinutes(date, timeZone) {
        const parts = getTimeZoneParts(date, timeZone);
        const timeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
        return Math.round((timeAsUtc - date.getTime()) / (60 * 1000));
    }

    function formatRelativeOffset(date, timeZone) {
        const targetOffset = getTimeZoneOffsetMinutes(date, timeZone);
        const localOffset = getTimeZoneOffsetMinutes(date, localTimeZone);
        const diffMinutes = targetOffset - localOffset;

        if (diffMinutes === 0) {
            return timeZone === localTimeZone ? 'Local Time' : 'Same Time';
        }

        const sign = diffMinutes > 0 ? '+' : '-';
        const absMinutes = Math.abs(diffMinutes);
        const hours = Math.floor(absMinutes / 60);
        const minutes = absMinutes % 60;
        const offset = minutes > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(hours);

        return `${sign}${offset} HRS`;
    }

    function getRelativeDayLabel(date, timeZone) {
        const localParts = getTimeZoneParts(date, localTimeZone);
        const targetParts = getTimeZoneParts(date, timeZone);
        const localDay = Date.UTC(localParts.year, localParts.month - 1, localParts.day);
        const targetDay = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
        const diffDays = Math.round((targetDay - localDay) / DAY_MS);

        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays > 1) return `${diffDays} days ahead`;
        if (diffDays < -1) return `${Math.abs(diffDays)} days behind`;
        return 'Today';
    }

    function getCityNameFromTimeZone(timeZone) {
        if (timeZoneNameOverrides[timeZone]) return timeZoneNameOverrides[timeZone];
        const city = timeZone.split('/').pop() || timeZone;
        return city.replace(/_/g, ' ');
    }

    function normalizeAlarm(alarm) {
        const safeTime = typeof alarm?.time === 'string' && /^\d{2}:\d{2}$/.test(alarm.time) ? alarm.time : '00:00';
        const days = Array.isArray(alarm?.days)
            ? alarm.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
            : [];

        return {
            id: Number.isFinite(Number(alarm?.id)) ? Number(alarm.id) : Date.now(),
            time: safeTime,
            label: String(alarm?.label || 'Alarm'),
            active: Boolean(alarm?.active),
            days: days.length > 0 ? [...new Set(days)] : [0, 1, 2, 3, 4, 5, 6],
            sound: String(alarm?.sound || 'classic')
        };
    }

    function getDefaultWorldClocks() {
        const defaults = [
            { id: 'local', name: getCityNameFromTimeZone(localTimeZone), tz: localTimeZone },
            { id: 'lon', name: 'London', tz: 'Europe/London' },
            { id: 'tok', name: 'Tokyo', tz: 'Asia/Tokyo' }
        ];
        const seen = new Set();
        return defaults.filter(clock => {
            if (seen.has(clock.tz)) return false;
            seen.add(clock.tz);
            return true;
        });
    }

    function normalizeWorldClock(clock, index) {
        const timeZone = isValidTimeZone(clock?.tz) ? clock.tz : localTimeZone;
        return {
            id: String(clock?.id || `${timeZone}-${index}`),
            name: String(clock?.name || getCityNameFromTimeZone(timeZone)),
            tz: timeZone
        };
    }

    // --- State & Persistence ---
    let alarms = readStoredArray('alarms', [
        { id: 1, time: '06:30', label: 'Morning Routine', active: true, days: [1, 2, 3, 4, 5], sound: 'classic' },
        { id: 2, time: '08:00', label: 'Weekend Sleep In', active: false, days: [6, 0], sound: 'chime' }
    ]).map(normalizeAlarm);

    function saveAlarms() {
        localStorage.setItem('alarms', JSON.stringify(alarms));
    }

    // --- DOM Elements ---
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const alarmList = document.querySelector('#alarms-view .card-list');
    const alarmModal = document.getElementById('alarm-modal');
    const addAlarmBtn = document.getElementById('add-alarm-btn');
    const saveAlarmBtn = document.getElementById('save-alarm');
    const cancelAlarmBtn = document.getElementById('cancel-alarm');
    const ringingOverlay = document.getElementById('ringing-overlay');
    const stopAlarmBtn = document.getElementById('stop-alarm');
    const addWorldClockBtn = document.getElementById('add-world-clock-btn');
    const alarmCountEl = document.querySelector('#alarms-view .header-text p');
    const worldClockCountEl = document.querySelector('#world-clock-view .header-text p');

    // --- Math Challenge Elements ---
    const mathProblemEl = document.getElementById('math-problem');
    const mathAnswerEl = document.getElementById('math-answer');
    const mathChallengeContainer = document.getElementById('math-challenge-container');

    function updateHeaderCounts() {
        const activeAlarmCount = alarms.filter(alarm => alarm.active).length;

        if (alarmCountEl) {
            alarmCountEl.textContent = `${activeAlarmCount} ${pluralize(activeAlarmCount, 'alarm')} active`;
        }

        if (worldClockCountEl) {
            worldClockCountEl.textContent = `${worldClocks.length} ${pluralize(worldClocks.length, 'timezone')} active`;
        }
    }

    // --- Navigation Logic ---
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            views.forEach(view => view.classList.remove('active'));
            const targetId = item.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // --- Misc UI Listeners ---
    // (Other UI listeners can be added here)

    // --- Alarm Rendering ---
    function renderAlarms() {
        alarmList.textContent = '';
        alarms.forEach(alarm => {
            const [h, m] = alarm.time.split(':');
            const hours = parseInt(h);
            const suffix = hours >= 12 ? 'PM' : 'AM';
            const h12 = hours % 12 || 12;
            const displayTime = `${String(h12).padStart(2, '0')}:${m}`;
            const activeDays = Array.isArray(alarm.days) ? alarm.days : [];

            const card = document.createElement('div');
            card.className = `alarm-card ${alarm.active ? 'active-alarm' : ''}`;

            const alarmTop = document.createElement('div');
            alarmTop.className = 'alarm-top';

            const timeGroup = document.createElement('div');
            timeGroup.className = 'alarm-time-group';

            const timeRow = document.createElement('div');
            timeRow.className = 'alarm-time-row';
            timeRow.append(
                createTextElement('span', 'alarm-time', displayTime),
                createTextElement('span', 'alarm-ampm', suffix)
            );

            timeGroup.append(
                timeRow,
                createTextElement('p', 'alarm-label', alarm.label)
            );

            const switchLabel = document.createElement('label');
            switchLabel.className = 'switch';
            const switchInput = document.createElement('input');
            switchInput.type = 'checkbox';
            switchInput.checked = alarm.active;
            switchInput.dataset.id = String(alarm.id);
            const switchSlider = document.createElement('span');
            switchSlider.className = 'slider round';
            switchLabel.append(switchInput, switchSlider);

            alarmTop.append(timeGroup, switchLabel);

            const dayPills = document.createElement('div');
            dayPills.className = 'day-pills';

            ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((day, i) => {
                const dayNum = (i + 1) % 7;
                const pill = createTextElement('div', `day-pill ${activeDays.includes(dayNum) ? 'active' : ''}`, day);
                pill.dataset.id = String(alarm.id);
                pill.dataset.day = String(dayNum);
                dayPills.appendChild(pill);
            });

            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-alarm-btn';
            deleteButton.type = 'button';
            deleteButton.dataset.id = String(alarm.id);
            deleteButton.setAttribute('aria-label', `Delete ${alarm.label}`);
            deleteButton.appendChild(createIcon('trash-2'));
            dayPills.appendChild(deleteButton);

            card.append(alarmTop, dayPills);
            alarmList.appendChild(card);
        });
        lucide.createIcons();
        attachAlarmListeners();
        updateHeaderCounts();
    }

    function attachAlarmListeners() {
        // Toggle Active
        document.querySelectorAll('.switch input').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const id = parseInt(e.target.dataset.id);
                const alarm = alarms.find(a => a.id === id);
                if (!alarm) return;
                alarm.active = e.target.checked;
                saveAlarms();
                renderAlarms();
            });
        });

        // Toggle Days
        document.querySelectorAll('.day-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const id = parseInt(pill.dataset.id);
                const day = parseInt(pill.dataset.day);
                const alarm = alarms.find(a => a.id === id);
                if (!alarm) return;
                if (alarm.days.includes(day)) {
                    alarm.days = alarm.days.filter(d => d !== day);
                } else {
                    alarm.days.push(day);
                }
                saveAlarms();
                renderAlarms();
            });
        });

        // Delete Alarm
        document.querySelectorAll('.delete-alarm-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this alarm?')) {
                    const id = parseInt(btn.dataset.id);
                    const alarm = alarms.find(a => a.id === id);
                    if (alarm && alarm.sound && alarm.sound.startsWith('custom_')) {
                        deleteCustomAudio(alarm.sound).catch(console.error);
                    }
                    alarms = alarms.filter(a => a.id !== id);
                    saveAlarms();
                    renderAlarms();
                }
            });
        });
    }

    // --- Modal Logic ---
    const modalDayPills = document.querySelectorAll('.modal-day-pill');

    addAlarmBtn.addEventListener('click', () => {
        // Clear all selected days and select today
        modalDayPills.forEach(p => p.classList.remove('active'));
        const today = new Date().getDay();
        const todayPill = Array.from(modalDayPills).find(p => parseInt(p.dataset.day) === today);
        if (todayPill) {
            todayPill.classList.add('active');
        }
        
        alarmModal.classList.add('active');
    });

    cancelAlarmBtn.addEventListener('click', () => {
        alarmModal.classList.remove('active');
    });

    modalDayPills.forEach(pill => {
        pill.addEventListener('click', () => pill.classList.toggle('active'));
    });

    saveAlarmBtn.addEventListener('click', () => {
        const hour = document.getElementById('new-alarm-hour').value;
        const minute = document.getElementById('new-alarm-minute').value;
        const ampm = document.getElementById('new-alarm-ampm').value;
        
        let h24 = parseInt(hour);
        if (ampm === 'PM' && h24 < 12) h24 += 12;
        if (ampm === 'AM' && h24 === 12) h24 = 0;
        
        const time = `${String(h24).padStart(2, '0')}:${minute}`;
        const label = document.getElementById('new-alarm-label').value.trim() || 'Alarm';
        const activeDays = Array.from(modalDayPills)
            .filter(p => p.classList.contains('active'))
            .map(p => parseInt(p.dataset.day));

        const sound = document.getElementById('new-alarm-sound').value || 'classic';

        const newAlarm = {
            id: Date.now(),
            time: time,
            label: label,
            active: true,
            sound: sound,
            days: activeDays.length > 0 ? activeDays : [0, 1, 2, 3, 4, 5, 6]
        };

        if (sound.startsWith('custom_') && pendingCustomAudioBlob) {
            saveCustomAudio(sound, pendingCustomAudioBlob).catch(e => console.error("Failed to save audio", e));
        }

        alarms.push(newAlarm);
        saveAlarms();
        renderAlarms();
        alarmModal.classList.remove('active');
        
        // Reset modal
        document.getElementById('new-alarm-label').value = '';
        document.getElementById('new-alarm-sound').value = 'classic';
        modalDayPills.forEach(p => p.classList.remove('active'));
        pendingCustomAudioBlob = null;
        pendingCustomAudioName = null;
    });

    // Sound Preview
    let pendingCustomAudioBlob = null;
    let pendingCustomAudioName = null;

    const soundSelect = document.getElementById('new-alarm-sound');
    const audioUpload = document.getElementById('custom-audio-upload');

    soundSelect.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            audioUpload.click();
        } else {
            stopAlarmSound(); 
            startAlarmSound(e.target.value);
            setTimeout(stopAlarmSound, 2000);
        }
    });

    audioUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            pendingCustomAudioBlob = file;
            pendingCustomAudioName = file.name;
            
            let customOption = Array.from(soundSelect.options).find(opt => opt.value.startsWith('custom_'));
            if (!customOption) {
                customOption = document.createElement('option');
                soundSelect.insertBefore(customOption, soundSelect.querySelector('option[value="custom"]'));
            }
            const customId = `custom_${Date.now()}`;
            customOption.value = customId;
            customOption.text = file.name;
            soundSelect.value = customId;
            
            const url = URL.createObjectURL(file);
            previewCustomAudio(url);
        } else {
            soundSelect.value = 'classic';
        }
        audioUpload.value = '';
    });

    function previewCustomAudio(url) {
        stopAlarmSound();
        const audio = new Audio(url);
        audio.play().catch(e => console.error(e));
        setTimeout(() => {
            audio.pause();
            URL.revokeObjectURL(url);
        }, 2000);
    }

    // --- Alarm Engine ---
    let ringingAlarm = null;
    let lastTriggeredTime = null;
    let audioCtx = null;
    let beepInterval = null;
    let patternTimeouts = [];
    let currentCustomAudio = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // Unlock audio context on any user interaction
    document.body.addEventListener('click', () => {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        } else if (!audioCtx) {
            initAudio();
        }
    });

    function playTone(freq, type, rampUp, rampDown) {
        if (!audioCtx) initAudio();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime); 
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + rampUp);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + rampDown); 
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + rampDown + 0.05);
    }

    function scheduleTone(fn, delay) {
        patternTimeouts.push(setTimeout(fn, delay));
    }

    async function startAlarmSound(soundType = 'classic') {
        initAudio();
        stopAlarmSound(); // Clear any existing

        if (soundType.startsWith('custom_')) {
            try {
                const blob = await getCustomAudio(soundType);
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    currentCustomAudio = new Audio(url);
                    currentCustomAudio.loop = true;
                    currentCustomAudio.play().catch(console.error);
                    return;
                }
            } catch (e) {
                console.error("Failed to play custom audio", e);
            }
            // Fallback to classic if blob not found
            soundType = 'classic';
        }

        let pattern;
        let intervalMs;

        if (soundType === 'chime') {
            pattern = () => {
                playTone(440, 'sine', 0.1, 0.9);
                scheduleTone(() => playTone(554, 'sine', 0.1, 0.9), 500);
            };
            intervalMs = 2000;
        } else if (soundType === 'buzzer') {
            pattern = () => {
                playTone(150, 'sawtooth', 0.05, 0.4);
                scheduleTone(() => playTone(150, 'sawtooth', 0.05, 0.4), 600);
            };
            intervalMs = 1500;
        } else if (soundType === 'fast') {
            pattern = () => {
                playTone(1000, 'square', 0.01, 0.04);
                scheduleTone(() => playTone(1000, 'square', 0.01, 0.04), 100);
                scheduleTone(() => playTone(1000, 'square', 0.01, 0.04), 200);
                scheduleTone(() => playTone(1000, 'square', 0.01, 0.04), 300);
                scheduleTone(() => playTone(1000, 'square', 0.01, 0.04), 400);
                scheduleTone(() => playTone(1000, 'square', 0.01, 0.04), 500);
            };
            intervalMs = 1000;
        } else {
            // Classic
            pattern = () => {
                playTone(800, 'square', 0.01, 0.1);
                scheduleTone(() => playTone(800, 'square', 0.01, 0.1), 150);
                scheduleTone(() => playTone(800, 'square', 0.01, 0.1), 300);
                scheduleTone(() => playTone(800, 'square', 0.01, 0.1), 450);
            };
            intervalMs = 1500;
        }

        pattern();
        beepInterval = setInterval(pattern, intervalMs);
    }

    function stopAlarmSound() {
        if (beepInterval) {
            clearInterval(beepInterval);
            beepInterval = null;
        }
        patternTimeouts.forEach(clearTimeout);
        patternTimeouts = [];
        
        if (currentCustomAudio) {
            currentCustomAudio.pause();
            if (currentCustomAudio.src) {
                URL.revokeObjectURL(currentCustomAudio.src);
            }
            currentCustomAudio = null;
        }
    }

    function checkAlarms() {
        if (ringingAlarm) return;

        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const currentDay = now.getDay();

        if (lastTriggeredTime === currentTime) return;

        let triggered = false;
        alarms.forEach(alarm => {
            if (alarm.active && alarm.time === currentTime && alarm.days.includes(currentDay)) {
                triggerAlarm(alarm);
                triggered = true;
            }
        });
        
        if (triggered) {
            lastTriggeredTime = currentTime;
        }
    }

    let currentMathAnswer = 0;

    function generateMathProblem() {
        // Randomly choose between two problem formats
        const format = Math.random() > 0.5 ? 'mult_add' : 'div_mult_add';
        
        if (format === 'mult_add') {
            const num1 = Math.floor(Math.random() * 8) + 2; // 2 to 9
            const num2 = Math.floor(Math.random() * 41) + 10; // 10 to 50
            const num3 = Math.floor(Math.random() * 450) + 50; // 50 to 500
            
            // Max potential: (9 * 50) + 500 = 950
            currentMathAnswer = (num1 * num2) + num3;
            mathProblemEl.textContent = `${num1} x ${num2} + ${num3} = ?`;
        } else {
            const num2 = Math.floor(Math.random() * 7) + 2; // divisor: 2 to 8
            const multiplier = Math.floor(Math.random() * 8) + 2; // result of division: 2 to 9
            const num1 = num2 * multiplier; // dividend (ensures whole number)
            const num3 = Math.floor(Math.random() * 41) + 10; // 10 to 50
            const num4 = Math.floor(Math.random() * 450) + 50; // 50 to 500
            
            // Max potential: (9 * 50) + 500 = 950
            currentMathAnswer = (num1 / num2) * num3 + num4;
            mathProblemEl.textContent = `${num1} / ${num2} x ${num3} + ${num4} = ?`;
        }
        
        mathAnswerEl.value = '';
    }

    let isTimerRinging = false;

    function triggerAlarm(alarm, isTimer = false) {
        ringingAlarm = alarm;
        isTimerRinging = isTimer;
        document.getElementById('ringing-label').textContent = alarm.label;
        
        const [h, m] = alarm.time.split(':');
        const h12 = parseInt(h) % 12 || 12;
        const suffix = parseInt(h) >= 12 ? 'PM' : 'AM';
        document.getElementById('ringing-time').textContent = alarm.time === '--:--' ? '--:--' : `${String(h12).padStart(2, '0')}:${m} ${suffix}`;
        
        if (isTimer) {
            mathChallengeContainer.style.display = 'none';
            document.getElementById('stop-alarm').textContent = 'Stop Timer';
        } else {
            mathChallengeContainer.style.display = 'block';
            document.getElementById('stop-alarm').textContent = 'Stop Alarm';
            generateMathProblem();
        }
        
        ringingOverlay.classList.add('active');
        startAlarmSound(alarm.sound || 'classic');
        
        if (!isTimer) {
            setTimeout(() => mathAnswerEl.focus(), 100);
        }
    }

    function attemptStopAlarm() {
        if (isTimerRinging) {
            ringingOverlay.classList.remove('active');
            stopAlarmSound();
            ringingAlarm = null;
            isTimerRinging = false;
            mathAnswerEl.value = '';
            return;
        }

        const userAnswer = parseInt(mathAnswerEl.value, 10);
        if (userAnswer === currentMathAnswer) {
            ringingOverlay.classList.remove('active');
            stopAlarmSound();
            ringingAlarm = null;
        } else {
            mathChallengeContainer.classList.remove('shake');
            // Trigger reflow to restart the animation
            void mathChallengeContainer.offsetWidth;
            mathChallengeContainer.classList.add('shake');
            mathAnswerEl.value = '';
            mathAnswerEl.focus();
        }
    }

    stopAlarmBtn.addEventListener('click', attemptStopAlarm);

    mathAnswerEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            attemptStopAlarm();
        }
    });

    // --- World Clock Logic ---
    let worldClocks = readStoredArray('worldClocks', getDefaultWorldClocks()).map(normalizeWorldClock);

    const worldClockList = document.querySelector('#world-clock-view .card-list');
    const worldClockModal = document.getElementById('world-clock-modal');
    const saveWorldClockBtn = document.getElementById('save-world-clock');
    const cancelWorldClockBtn = document.getElementById('cancel-world-clock');

    function saveWorldClocks() {
        localStorage.setItem('worldClocks', JSON.stringify(worldClocks));
    }

    addWorldClockBtn?.addEventListener('click', () => {
        worldClockModal.classList.add('active');
    });

    cancelWorldClockBtn?.addEventListener('click', () => {
        worldClockModal.classList.remove('active');
    });

    saveWorldClockBtn?.addEventListener('click', () => {
        const select = document.getElementById('new-city-select');
        const tz = select.value;
        const cityName = select.options[select.selectedIndex].text.split(' (')[0];

        const newClock = {
            id: Date.now().toString(),
            name: cityName,
            tz: tz
        };

        worldClocks.push(newClock);
        saveWorldClocks();
        renderWorldClocks();
        worldClockModal.classList.remove('active');
    });

    function renderWorldClocks() {
        worldClockList.textContent = '';
        worldClocks.forEach(clock => {
            const card = document.createElement('div');
            card.className = 'card';

            const cardTop = document.createElement('div');
            cardTop.className = 'card-top';

            const locationInfo = document.createElement('div');
            locationInfo.className = 'location-info';
            locationInfo.append(
                createTextElement('h3', '', clock.name),
                createTextElement('p', 'subtitle', '')
            );

            const timeInfo = document.createElement('div');
            timeInfo.className = 'time-info';
            const timeEl = createTextElement('span', 'time', '00:00');
            timeEl.dataset.tz = clock.tz;
            timeInfo.append(
                timeEl,
                createTextElement('span', 'ampm', 'AM')
            );

            cardTop.append(locationInfo, timeInfo);

            const cardBottom = document.createElement('div');
            cardBottom.className = 'card-bottom';

            const phaseInfo = document.createElement('div');
            phaseInfo.className = 'phase-info';
            phaseInfo.append(
                createIcon('sun'),
                createTextElement('span', '', 'MORNING')
            );

            const dayInfo = document.createElement('div');
            dayInfo.className = 'day-info';
            dayInfo.appendChild(createTextElement('span', '', 'Today'));

            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-clock-btn';
            deleteButton.type = 'button';
            deleteButton.dataset.id = clock.id;
            deleteButton.setAttribute('aria-label', `Remove ${clock.name}`);
            deleteButton.appendChild(createIcon('x'));

            cardBottom.append(phaseInfo, dayInfo, deleteButton);
            card.append(cardTop, cardBottom);
            worldClockList.appendChild(card);
        });
        attachWorldClockListeners();
        updateClocks(); // Initial update
        updateHeaderCounts();
    }

    function attachWorldClockListeners() {
        document.querySelectorAll('.delete-clock-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.dataset.id;
                worldClocks = worldClocks.filter(c => c.id !== id);
                saveWorldClocks();
                renderWorldClocks();
            });
        });
    }

    function updateClocks() {
        const now = new Date();
        const timeEls = document.querySelectorAll('.time[data-tz]');
        let iconsChanged = false;
        
        timeEls.forEach(el => {
            const tz = el.getAttribute('data-tz');
            const cardEl = el.closest('.card');
            iconsChanged = updateTimeDisplay(now, tz, el, cardEl) || iconsChanged;
        });

        if (iconsChanged) {
            lucide.createIcons();
        }
        
        // Also check alarms every second
        checkAlarms();
    }

    function updateTimeDisplay(date, timeZone, timeEl, cardEl) {
        if (!timeEl) return false;
        
        try {
            const options = { timeZone, hour: '2-digit', minute: '2-digit', hour12: true };
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const parts = formatter.formatToParts(date);
            
            let hour = parts.find(p => p.type === 'hour').value;
            let minute = parts.find(p => p.type === 'minute').value;
            let dayPeriod = parts.find(p => p.type === 'dayPeriod').value;

            timeEl.textContent = `${hour.padStart(2, '0')}:${minute}`;
            
            const ampmEl = timeEl.nextElementSibling;
            if (ampmEl && ampmEl.classList.contains('ampm')) {
                ampmEl.textContent = dayPeriod.toUpperCase();
                ampmEl.classList.toggle('active-text', dayPeriod.toUpperCase() === 'AM');
            }

            if (cardEl) {
                const timeZoneParts = getTimeZoneParts(date, timeZone);
                const hours = timeZoneParts.hour;
                
                const phaseEl = cardEl.querySelector('.phase-info');
                const phaseText = phaseEl?.querySelector('span');
                const subtitleEl = cardEl.querySelector('.subtitle');
                
                let phase = 'NIGHT';
                let icon = 'moon';
                if (hours >= 6 && hours < 12) { phase = 'MORNING'; icon = 'sun'; }
                else if (hours >= 12 && hours < 18) { phase = 'AFTERNOON'; icon = 'sun-dim'; }
                else if (hours >= 18 && hours < 22) { phase = 'EVENING'; icon = 'cloud-moon'; }

                if (phaseText) phaseText.textContent = phase;
                const iconChanged = setLucideIcon(phaseEl, icon);

                if (subtitleEl) {
                    subtitleEl.textContent = formatRelativeOffset(date, timeZone);
                }

                const dayEl = cardEl.querySelector('.day-info span');
                if (dayEl) {
                    const dayLabel = getRelativeDayLabel(date, timeZone);
                    dayEl.textContent = dayLabel;
                    dayEl.parentElement.classList.toggle('active-text', dayLabel !== 'Today');
                }

                return iconChanged;
            }
        } catch (e) {
            console.error("Error updating time for timezone:", timeZone, e);
        }
        return false;
    }

    // --- Stopwatch Logic ---
    let swStartTime = 0;
    let swElapsedTime = 0;
    let swInterval = null;
    let swRunning = false;
    let swLaps = [];

    const swDisplay = document.getElementById('stopwatch-display');
    const swStartPauseBtn = document.getElementById('sw-start-pause');
    const swLapResetBtn = document.getElementById('sw-lap-reset');
    const swLapList = document.getElementById('lap-list');

    function formatTimeSW(ms) {
        const date = new Date(ms);
        const m = String(date.getUTCMinutes()).padStart(2, '0');
        const s = String(date.getUTCSeconds()).padStart(2, '0');
        const msStr = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, '0');
        return `${m}:${s}.${msStr}`;
    }

    function updateSWDisplay() {
        const currentTime = swRunning ? Date.now() - swStartTime : swElapsedTime;
        swDisplay.textContent = formatTimeSW(currentTime);
    }

    swStartPauseBtn.addEventListener('click', () => {
        if (swRunning) {
            swRunning = false;
            swElapsedTime = Date.now() - swStartTime;
            clearInterval(swInterval);
            setButtonIcon(swStartPauseBtn, 'play');
            setButtonIcon(swLapResetBtn, 'refresh-cw');
        } else {
            swRunning = true;
            swStartTime = Date.now() - swElapsedTime;
            swInterval = setInterval(updateSWDisplay, 10);
            setButtonIcon(swStartPauseBtn, 'pause');
            setButtonIcon(swLapResetBtn, 'flag');
        }
        lucide.createIcons();
    });

    swLapResetBtn.addEventListener('click', () => {
        if (swRunning) {
            // Lap
            const currentLapTime = Date.now() - swStartTime;
            swLaps.unshift(currentLapTime);
            renderLaps();
        } else {
            // Reset
            swElapsedTime = 0;
            swLaps = [];
            updateSWDisplay();
            renderLaps();
        }
    });

    function renderLaps() {
        swLapList.textContent = '';
        swLaps.forEach((lapMs, index) => {
            const lapItem = document.createElement('li');
            lapItem.className = 'lap-item';
            
            // Calculate relative lap time
            let relativeLapMs = lapMs;
            if (index < swLaps.length - 1) {
                relativeLapMs = lapMs - swLaps[index + 1];
            }

            lapItem.append(
                createTextElement('span', 'lap-index', `Lap ${swLaps.length - index}`),
                createTextElement('span', 'lap-time', formatTimeSW(relativeLapMs))
            );
            swLapList.appendChild(lapItem);
        });
    }

    // --- Timer Logic ---
    let tmEndTime = 0;
    let tmRemaining = 0;
    let tmInterval = null;
    let tmRunning = false;

    const tmHoursSelect = document.getElementById('timer-hours');
    const tmMinutesSelect = document.getElementById('timer-minutes');
    const tmSecondsSelect = document.getElementById('timer-seconds');
    const tmDisplay = document.getElementById('timer-display');
    const tmInputContainer = document.getElementById('timer-input-container');
    const tmStartPauseBtn = document.getElementById('tm-start-pause');
    const tmCancelBtn = document.getElementById('tm-cancel');

    function populateTimerSelects() {
        for (let i = 0; i < 24; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = String(i).padStart(2, '0');
            tmHoursSelect.appendChild(opt);
        }
        for (let i = 0; i < 60; i++) {
            const opt1 = document.createElement('option');
            opt1.value = i;
            opt1.textContent = String(i).padStart(2, '0');
            tmMinutesSelect.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = i;
            opt2.textContent = String(i).padStart(2, '0');
            tmSecondsSelect.appendChild(opt2);
        }
    }
    populateTimerSelects();

    function formatTimeTM(ms) {
        const totalSeconds = Math.ceil(ms / 1000);
        const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(totalSeconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function updateTMDisplay() {
        if (tmRunning) {
            tmRemaining = tmEndTime - Date.now();
        }
        if (tmRemaining <= 0) {
            tmRemaining = 0;
            tmRunning = false;
            clearInterval(tmInterval);
            tmDisplay.textContent = '00:00:00';
            setButtonIcon(tmStartPauseBtn, 'play');
            tmStartPauseBtn.disabled = true;
            lucide.createIcons();
            
            // Trigger Timer Alarm! (using triggerAlarm with a fake alarm object)
            triggerAlarm({
                label: 'Timer Finished',
                time: '--:--',
                sound: 'classic' // default
            }, true);
            
            // Reset UI
            resetTimerUI();
            return;
        }
        tmDisplay.textContent = formatTimeTM(tmRemaining);
    }

    function getSelectedTMDuration() {
        const h = parseInt(tmHoursSelect.value) || 0;
        const m = parseInt(tmMinutesSelect.value) || 0;
        const s = parseInt(tmSecondsSelect.value) || 0;
        return (h * 3600 + m * 60 + s) * 1000;
    }

    function resetTimerUI() {
        tmInputContainer.classList.remove('hidden');
        tmDisplay.classList.add('hidden');
        tmCancelBtn.disabled = true;
        setButtonIcon(tmStartPauseBtn, 'play');
        tmStartPauseBtn.disabled = false;
        lucide.createIcons();
        tmRemaining = 0;
    }

    tmStartPauseBtn.addEventListener('click', () => {
        if (tmRunning) {
            // Pause
            tmRunning = false;
            clearInterval(tmInterval);
            setButtonIcon(tmStartPauseBtn, 'play');
        } else {
            // Start or Resume
            if (tmRemaining === 0) {
                // Starting fresh
                tmRemaining = getSelectedTMDuration();
                if (tmRemaining === 0) return; // Nothing to count down
                
                tmInputContainer.classList.add('hidden');
                tmDisplay.classList.remove('hidden');
                tmCancelBtn.disabled = false;
            }
            tmEndTime = Date.now() + tmRemaining;
            tmRunning = true;
            tmInterval = setInterval(updateTMDisplay, 50); // fast update for smooth display
            setButtonIcon(tmStartPauseBtn, 'pause');
        }
        lucide.createIcons();
    });

    tmCancelBtn.addEventListener('click', () => {
        tmRunning = false;
        clearInterval(tmInterval);
        resetTimerUI();
    });

    // --- Initialization ---
    renderAlarms();
    renderWorldClocks();
    setInterval(updateClocks, 1000);
});
