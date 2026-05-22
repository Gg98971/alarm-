document.addEventListener('DOMContentLoaded', () => {
    // --- Global Variables ---
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeZoneNameOverrides = {};
    const DAY_MS = 24 * 60 * 60 * 1000;

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

    async function getAllCustomAudios() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.openCursor();
            const results = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    results.push({ id: cursor.key, blob: cursor.value });
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async function populateCustomSoundOptions() {
        const soundSelect = document.getElementById('new-alarm-sound');
        if (!soundSelect) return;
        
        // Remove existing dynamically added custom options
        Array.from(soundSelect.options).forEach(opt => {
            if (opt.value.startsWith('custom_')) {
                opt.remove();
            }
        });
        
        try {
            const customAudios = await getAllCustomAudios();
            const customUploadOpt = soundSelect.querySelector('option[value="custom"]');
            if (!customUploadOpt) return;
            
            customAudios.forEach(({ id, blob }) => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `Custom: ${blob.name || 'Audio'}`;
                soundSelect.insertBefore(opt, customUploadOpt);
            });
        } catch (e) {
            console.error("Failed to load custom audio options", e);
        }
    }

    // --- Capacitor Native Bridge ---
    const isCapacitor = window.hasOwnProperty('Capacitor');
    let LocalNotifications = null;
    let CustomAlarm = null;

    // --- Alarm Data & Helpers (Must be initialized before Capacitor events) ---
    function generateValidAlarmId(existingId) {
        let id = Number(existingId);
        if (Number.isFinite(id) && id > 0 && id <= 2147483647) {
            return id;
        }
        return Math.floor(Math.random() * 1000000000) + 1;
    }

    function readStoredArray(key, fallback) {
        try {
            const stored = JSON.parse(localStorage.getItem(key));
            return Array.isArray(stored) ? stored : fallback;
        } catch (e) {
            console.warn(`Ignoring invalid ${key} data`, e);
            return fallback;
        }
    }

    function normalizeAlarm(alarm) {
        const safeTime = typeof alarm?.time === 'string' && /^\d{2}:\d{2}$/.test(alarm.time) ? alarm.time : '00:00';
        const days = Array.isArray(alarm?.days)
            ? alarm.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
            : [];

        return {
            id: generateValidAlarmId(alarm?.id),
            time: safeTime,
            label: String(alarm?.label || 'Alarm'),
            active: Boolean(alarm?.active),
            days: days.length > 0 ? [...new Set(days)] : [0, 1, 2, 3, 4, 5, 6],
            sound: String(alarm?.sound || 'classic')
        };
    }

    let alarms = readStoredArray('alarms', [
        { id: 1, time: '06:30', label: 'Morning Routine', active: true, days: [1, 2, 3, 4, 5], sound: 'classic' },
        { id: 2, time: '08:00', label: 'Weekend Sleep In', active: false, days: [6, 0], sound: 'chime' }
    ]).map(normalizeAlarm);

    async function scheduleNativeAlarm(alarm) {
        if (!isCapacitor || !alarm.active) return;
        
        const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
        if (!CustomAlarm) return;

        const [hour, minute] = alarm.time.split(':').map(Number);
        const now = new Date();
        let alarmDate = new Date();
        alarmDate.setHours(hour, minute, 0, 0);

        if (alarmDate <= now) {
            alarmDate.setDate(alarmDate.getDate() + 1);
        }

        if (Array.isArray(alarm.days) && alarm.days.length > 0) {
            let count = 0;
            while (!alarm.days.includes(alarmDate.getDay()) && count < 7) {
                alarmDate.setDate(alarmDate.getDate() + 1);
                count++;
            }
        }
        
        try {
            await CustomAlarm.schedule({
                id: alarm.id,
                time: alarmDate.getTime()
            });
            console.log(`Scheduled native alarm ${alarm.id} for ${alarmDate}`);
        } catch (err) {
            console.warn(`Failed to schedule native alarm ${alarm.id}, trying to request exact alarm permission:`, err);
            try {
                await CustomAlarm.requestExactAlarmPermission();
                await CustomAlarm.schedule({
                    id: alarm.id,
                    time: alarmDate.getTime()
                });
                console.log(`Scheduled native alarm ${alarm.id} after requesting permission`);
            } catch (retryErr) {
                console.error(`Retry scheduling native alarm ${alarm.id} failed:`, retryErr);
            }
        }
    }

    async function cancelNativeAlarm(id) {
        if (!isCapacitor) return;
        
        const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
        if (!CustomAlarm) return;

        await CustomAlarm.cancel({ id });
        console.log(`Cancelled native alarm ${id}`);
    }

    function saveAlarms() {
        localStorage.setItem('alarms', JSON.stringify(alarms));
        alarms.forEach(alarm => {
            if (alarm.active) {
                scheduleNativeAlarm(alarm);
            } else {
                cancelNativeAlarm(alarm.id);
            }
        });
    }

    const TIMER_NOTIFICATION_ID = 999999;

    async function scheduleNativeTimer(endTimeMs) {
        if (!isCapacitor) return;
        
        const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
        if (!CustomAlarm) return;

        try {
            await CustomAlarm.schedule({
                id: TIMER_NOTIFICATION_ID,
                time: endTimeMs
            });
            console.log(`Scheduled native timer for ${new Date(endTimeMs)}`);
        } catch (err) {
            console.warn('Failed to schedule native timer, trying to request exact alarm permission:', err);
            try {
                await CustomAlarm.requestExactAlarmPermission();
                await CustomAlarm.schedule({
                    id: TIMER_NOTIFICATION_ID,
                    time: endTimeMs
                });
                console.log(`Scheduled native timer after requesting permission`);
            } catch (retryErr) {
                console.error('Retry scheduling native timer failed:', retryErr);
            }
        }
    }

    async function cancelNativeTimer() {
        if (!isCapacitor) return;
        
        const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
        if (!CustomAlarm) return;

        await CustomAlarm.cancel({ id: TIMER_NOTIFICATION_ID });
        console.log(`Cancelled native timer`);
    }

    async function initCapacitor() {
        if (isCapacitor) {
            LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
            const App = window.Capacitor.Plugins.App;
            
            // Check and request permissions
            try {
                let perm = await LocalNotifications.checkPermissions();
                if (perm.display !== 'granted') {
                    perm = await LocalNotifications.requestPermissions();
                }
                console.log('Native Notification Permission:', perm);
            } catch (e) {
                console.warn('Failed to check/request permissions', e);
            }

            const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
            if (CustomAlarm) {
                try {
                    const perm = await CustomAlarm.checkPermissions();
                    console.log('CustomAlarm Exact Alarm Permission:', perm);
                    if (perm && perm.exactAlarmGranted === false) {
                        await CustomAlarm.requestExactAlarmPermission();
                    }
                } catch (e) {
                    console.warn('Failed to check exact alarm permissions:', e);
                }
            }

            // Create high importance notification channel
            try {
                await LocalNotifications.createChannel({
                    id: 'alarm_channel',
                    name: 'Alarms',
                    description: 'High importance channel for alarm notifications',
                    importance: 5, // IMPORTANCE_MAX
                    visibility: 1, // VISIBILITY_PUBLIC
                    vibration: true
                });
            } catch (e) {
                console.warn('Failed to create notification channel', e);
            }
            
            // Sync current alarms with native scheduler
            saveAlarms();
            
            await LocalNotifications.registerActionTypes({
                types: [
                    {
                        id: 'ALARM_ACTION',
                        actions: [
                            { id: 'view', title: 'Open Alarm' }
                        ]
                    }
                ]
            });

            LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
                console.log('Notification action performed', notification);
                const extra = notification.notification?.extra || {};
                if (extra.isTimer) {
                    triggerAlarm({
                        label: 'Timer Finished',
                        time: '--:--',
                        sound: 'classic'
                    }, true);
                } else if (extra.alarmId) {
                    const alarm = alarms.find(a => a.id === extra.alarmId);
                    if (alarm) {
                        triggerAlarm(alarm);
                    }
                }
            });

            LocalNotifications.addListener('localNotificationReceived', (notification) => {
                console.log('Notification received', notification);
                const extra = notification?.extra || {};
                if (extra.isTimer) {
                    triggerAlarm({
                        label: 'Timer Finished',
                        time: '--:--',
                        sound: 'classic'
                    }, true);
                } else if (extra.alarmId) {
                    const alarm = alarms.find(a => a.id === extra.alarmId);
                    if (alarm) {
                        triggerAlarm(alarm);
                    }
                }
            });

            // Hardware Back Button Handling
            if (App) {
                App.addListener('backButton', ({ canGoBack }) => {
                    const activeModal = document.querySelector('.modal.active, .overlay.active');
                    if (activeModal) {
                        activeModal.classList.remove('active');
                        return;
                    }
                    
                    if (canGoBack) {
                        window.history.back();
                    } else {
                        App.exitApp();
                    }
                });

                const checkActiveNativeAlarm = async () => {
                    const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
                    if (!CustomAlarm) return;
                    try {
                        const res = await CustomAlarm.getActiveAlarm();
                        console.log('Checked active native alarm:', res);
                        if (res && res.active) {
                            if (res.alarmId === TIMER_NOTIFICATION_ID) {
                                triggerAlarm({
                                    label: 'Timer Finished',
                                    time: '--:--',
                                    sound: 'classic'
                                }, true);
                            } else {
                                const alarm = alarms.find(a => a.id === res.alarmId);
                                if (alarm) {
                                    triggerAlarm(alarm);
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to get active alarm from native:', e);
                    }
                };

                const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
                if (CustomAlarm) {
                    CustomAlarm.addListener('alarmTriggered', (data) => {
                        console.log('Native alarm triggered event received:', data);
                        if (data && data.alarmId !== undefined) {
                            if (data.alarmId === TIMER_NOTIFICATION_ID) {
                                triggerAlarm({
                                    label: 'Timer Finished',
                                    time: '--:--',
                                    sound: 'classic'
                                }, true);
                            } else {
                                const alarm = alarms.find(a => a.id === data.alarmId);
                                if (alarm) {
                                    triggerAlarm(alarm);
                                }
                            }
                        }
                    });
                    checkActiveNativeAlarm();
                }

                App.addListener('appStateChange', ({ isActive }) => {
                    if (isActive) {
                        renderAlarms();
                        if (typeof updateClocks === 'function') updateClocks();
                        if (typeof updateTMDisplay === 'function' && tmRunning) {
                            updateTMDisplay();
                        }
                        checkActiveNativeAlarm();
                    }
                });
            }
        }
    }

    initCapacitor();

    // --- PWA & Notifications (Fallback) ---
    function requestNotificationPermission() {
        if (!isCapacitor && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
    
    requestNotificationPermission();

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

    let editingAlarmId = null;

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
    const TAB_ORDER = ['alarms-view', 'world-clock-view', 'stopwatch-view', 'timer-view'];
    let currentTabIndex = TAB_ORDER.indexOf('world-clock-view'); // matches the initially active view
    let isAnimating = false;

    // Build swipe-hint dots in the dedicated bar
    const swipeHint = document.getElementById('swipe-dots-bar');
    TAB_ORDER.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = 'swipe-dot' + (i === currentTabIndex ? ' active' : '');
        swipeHint.appendChild(dot);
    });

    function updateSwipeDots(index) {
        swipeHint.querySelectorAll('.swipe-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
        });
    }

    function switchView(targetIndex, animate = true) {
        if (isAnimating || targetIndex === currentTabIndex) return;
        if (targetIndex < 0 || targetIndex >= TAB_ORDER.length) return;

        const goingForward = targetIndex > currentTabIndex;
        const outClass  = goingForward ? 'slide-out-left'  : 'slide-out-right';
        const inClass   = goingForward ? 'slide-in-right'  : 'slide-in-left';

        const oldView = document.getElementById(TAB_ORDER[currentTabIndex]);
        const newView = document.getElementById(TAB_ORDER[targetIndex]);

        // Sync nav tab highlight
        navItems.forEach(nav => nav.classList.remove('active'));
        navItems[targetIndex].classList.add('active');

        if (!animate) {
            oldView.classList.remove('active');
            newView.classList.add('active');
            currentTabIndex = targetIndex;
            updateSwipeDots(currentTabIndex);
            return;
        }

        isAnimating = true;

        // Kick off animations
        oldView.classList.remove('active');
        oldView.classList.add(outClass);
        newView.classList.add(inClass);

        const DURATION = 340; // ms — matches CSS animation duration + tiny buffer

        setTimeout(() => {
            oldView.classList.remove(outClass);
            newView.classList.remove(inClass);
            newView.classList.add('active');
            currentTabIndex = targetIndex;
            updateSwipeDots(currentTabIndex);
            isAnimating = false;
        }, DURATION);
    }

    // Click on nav tabs
    navItems.forEach((item, idx) => {
        item.addEventListener('click', () => switchView(idx));
    });

    // --- Swipe Gesture Detection ---
    const mainContent = document.querySelector('.main-content');
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    mainContent.addEventListener('touchstart', (e) => {
        // Ignore if a modal is open
        if (document.querySelector('.modal.active, .overlay.active')) return;

        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
    }, { passive: true });

    mainContent.addEventListener('touchend', (e) => {
        if (!touchStartX) return;
        // Ignore if a modal is open
        if (document.querySelector('.modal.active, .overlay.active')) return;

        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const dt = Date.now() - touchStartTime;

        // Reset
        touchStartX = 0;
        touchStartY = 0;

        // Conditions for a valid horizontal swipe:
        //   • Horizontal movement > 50px
        //   • Vertical drift < 80px (not a scroll)
        //   • Completed in < 600ms (not a slow drag)
        const isHorizontal = Math.abs(dx) > 50 && Math.abs(dy) < 80 && dt < 600;
        if (!isHorizontal) return;

        if (dx < 0) {
            // Swipe LEFT → next tab (wraps from last → first)
            switchView((currentTabIndex + 1) % TAB_ORDER.length);
        } else {
            // Swipe RIGHT → previous tab (wraps from first → last)
            switchView((currentTabIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length);
        }
    }, { passive: true });

    // --- Misc UI Listeners ---
    // (Other UI listeners can be added here)


    // --- Alarm Countdown Helpers ---
    function getNextAlarmTimestamp(alarm, nowMs = Date.now()) {
        if (!alarm.active) return Infinity;

        const now = new Date(nowMs);
        const [hourStr, minuteStr] = alarm.time.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);

        let targetDate = new Date(now);
        targetDate.setHours(hour, minute, 0, 0);

        const activeDays = Array.isArray(alarm.days) && alarm.days.length > 0 ? alarm.days : [0, 1, 2, 3, 4, 5, 6];
        const currentDay = now.getDay();

        if (activeDays.includes(currentDay) && targetDate > now) {
            // Rings later today
        } else {
            for (let i = 1; i <= 7; i++) {
                const nextDay = (currentDay + i) % 7;
                if (activeDays.includes(nextDay)) {
                    targetDate.setDate(targetDate.getDate() + i);
                    break;
                }
            }
        }
        return targetDate.getTime();
    }

    function formatTimeRemaining(diffMs) {
        if (diffMs <= 0) return 'Ringing...';
        const totalMinutes = Math.floor(diffMs / 60000);
        if (totalMinutes === 0) return 'Alarm in less than 1 min';

        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const mins = totalMinutes % 60;

        let parts = [];
        if (days > 0) parts.push(`${days} ${pluralize(days, 'day')}`);
        if (hours > 0) parts.push(`${hours} ${pluralize(hours, 'hr')}`);
        if (mins > 0) parts.push(`${mins} ${pluralize(mins, 'min')}`);

        let timeString = '';
        if (parts.length === 1) {
            timeString = parts[0];
        } else if (parts.length === 2) {
            timeString = `${parts[0]} and ${parts[1]}`;
        } else if (parts.length === 3) {
            timeString = `${parts[0]}, ${parts[1]} and ${parts[2]}`;
        }

        return `Alarm in ${timeString}`;
    }

    function updateAllAlarmCountdowns() {
        const nowMs = Date.now();
        let needsResort = false;

        document.querySelectorAll('.alarm-countdown-badge').forEach(badge => {
            const id = Number(badge.dataset.id);
            const alarm = alarms.find(a => a.id === id);
            if (!alarm) return;

            if (alarm.active) {
                const diff = getNextAlarmTimestamp(alarm, nowMs) - nowMs;
                badge.textContent = formatTimeRemaining(diff);
                badge.classList.add('active');
            } else {
                badge.textContent = 'Alarm off';
                badge.classList.remove('active');
            }
        });

        for (let i = 0; i < alarms.length - 1; i++) {
            const a = alarms[i];
            const b = alarms[i + 1];
            if (a.active && b.active) {
                if (getNextAlarmTimestamp(a, nowMs) > getNextAlarmTimestamp(b, nowMs)) {
                    needsResort = true;
                    break;
                }
            }
        }

        if (needsResort) {
            renderAlarms();
        }
    }

    // --- Alarm Rendering ---
    function renderAlarms() {
        alarmList.textContent = '';
        alarms.sort((a, b) => {
            if (a.active !== b.active) {
                return a.active ? -1 : 1;
            }
            if (a.active) {
                return getNextAlarmTimestamp(a) - getNextAlarmTimestamp(b);
            }
            return a.time.localeCompare(b.time);
        });

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

            const rightControls = document.createElement('div');
            rightControls.className = 'alarm-right-controls';

            const switchLabel = document.createElement('label');
            switchLabel.className = 'switch';
            const switchInput = document.createElement('input');
            switchInput.type = 'checkbox';
            switchInput.checked = alarm.active;
            switchInput.dataset.id = String(alarm.id);
            const switchSlider = document.createElement('span');
            switchSlider.className = 'slider round';
            switchLabel.append(switchInput, switchSlider);

            const badge = document.createElement('div');
            badge.className = `alarm-countdown-badge ${alarm.active ? 'active' : ''}`;
            badge.dataset.id = String(alarm.id);
            if (alarm.active) {
                const diff = getNextAlarmTimestamp(alarm) - Date.now();
                badge.textContent = formatTimeRemaining(diff);
            } else {
                badge.textContent = 'Alarm off';
            }

            rightControls.append(switchLabel);

            alarmTop.append(timeGroup, rightControls);

            const dayPills = document.createElement('div');
            dayPills.className = 'day-pills';

            ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((day, i) => {
                const dayNum = (i + 1) % 7;
                const pill = createTextElement('div', `day-pill ${activeDays.includes(dayNum) ? 'active' : ''}`, day);
                pill.dataset.id = String(alarm.id);
                pill.dataset.day = String(dayNum);
                dayPills.appendChild(pill);
            });

            const actionButtons = document.createElement('div');
            actionButtons.className = 'alarm-action-buttons';

            const editButton = document.createElement('button');
            editButton.className = 'edit-alarm-btn';
            editButton.type = 'button';
            editButton.dataset.id = String(alarm.id);
            editButton.setAttribute('aria-label', `Edit ${alarm.label}`);
            editButton.appendChild(createIcon('pencil'));
            editButton.onclick = (e) => {
                e.stopPropagation();
                openAlarmModal(alarm);
            };

            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-alarm-btn';
            deleteButton.type = 'button';
            deleteButton.dataset.id = String(alarm.id);
            deleteButton.setAttribute('aria-label', `Delete ${alarm.label}`);
            deleteButton.appendChild(createIcon('trash-2'));
            
            actionButtons.append(editButton, deleteButton);
            dayPills.appendChild(actionButtons);

            card.append(alarmTop, badge, dayPills);
            
            // Edit listener (entire card except interactive parts)
            timeGroup.addEventListener('click', () => openAlarmModal(alarm));
            badge.addEventListener('click', () => openAlarmModal(alarm));
            dayPills.addEventListener('click', (e) => {
                if (e.target.closest('.delete-alarm-btn')) return;
                // If clicked on dayPills but NOT a pill (the gap), open modal
                if (!e.target.classList.contains('day-pill')) openAlarmModal(alarm);
            });

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
                        const otherUsers = alarms.filter(a => a.id !== id && a.sound === alarm.sound);
                        if (otherUsers.length === 0) {
                            deleteCustomAudio(alarm.sound).then(() => populateCustomSoundOptions()).catch(console.error);
                        }
                    }
                    cancelNativeAlarm(id);
                    alarms = alarms.filter(a => a.id !== id);
                    saveAlarms();
                    renderAlarms();
                }
            });
        });
    }

    // --- Modal Logic ---
    const modalDayPills = document.querySelectorAll('.modal-day-pill');

    async function openAlarmModal(alarm = null) {
        await populateCustomSoundOptions();
        editingAlarmId = alarm ? alarm.id : null;
        const modalTitle = alarmModal.querySelector('h3');
        const saveBtn = document.getElementById('save-alarm');
        
        if (alarm) {
            modalTitle.textContent = 'Edit Alarm';
            saveBtn.textContent = 'Update';
            const [h, m] = alarm.time.split(':');
            let h24 = parseInt(h);
            const ampm = h24 >= 12 ? 'PM' : 'AM';
            let h12 = h24 % 12 || 12;
            
            document.getElementById('new-alarm-hour').value = String(h12).padStart(2, '0');
            document.getElementById('new-alarm-minute').value = m;
            document.getElementById('new-alarm-ampm').value = ampm;
            document.getElementById('new-alarm-label').value = alarm.label;
            document.getElementById('new-alarm-sound').value = alarm.sound;
            
            modalDayPills.forEach(p => {
                p.classList.toggle('active', alarm.days.includes(parseInt(p.dataset.day)));
            });
        } else {
            modalTitle.textContent = 'Add Alarm';
            saveBtn.textContent = 'Save';
            // Auto-detect current time
            const now = new Date();
            let hours = now.getHours();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const h12 = hours % 12 || 12;
            const minutes = now.getMinutes();

            document.getElementById('new-alarm-hour').value = String(h12).padStart(2, '0');
            document.getElementById('new-alarm-minute').value = String(minutes).padStart(2, '0');
            document.getElementById('new-alarm-ampm').value = ampm;
            document.getElementById('new-alarm-label').value = '';
            document.getElementById('new-alarm-sound').value = 'classic';
            
            // Default to today selected
            modalDayPills.forEach(p => p.classList.remove('active'));
            const today = now.getDay();
            const todayPill = Array.from(modalDayPills).find(p => parseInt(p.dataset.day) === today);
            if (todayPill) todayPill.classList.add('active');
        }
        
        updateModalAlarmDiff();
        alarmModal.classList.add('active');
    }

    function updateModalAlarmDiff() {
        const diffEl = document.getElementById('modal-alarm-diff');
        if (!diffEl) return;
        const hour = document.getElementById('new-alarm-hour').value;
        const minute = document.getElementById('new-alarm-minute').value;
        const ampm = document.getElementById('new-alarm-ampm').value;
        let h24 = parseInt(hour, 10);
        if (ampm === 'PM' && h24 < 12) h24 += 12;
        if (ampm === 'AM' && h24 === 12) h24 = 0;
        const m = parseInt(minute, 10);

        const now = new Date();
        const activeDays = Array.from(modalDayPills)
            .filter(p => p.classList.contains('active'))
            .map(p => parseInt(p.dataset.day, 10));

        let targetDate = new Date(now);
        targetDate.setHours(h24, m, 0, 0);

        if (activeDays.length === 0) {
            if (targetDate <= now) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
        } else {
            const currentDay = now.getDay();
            if (activeDays.includes(currentDay) && targetDate > now) {
                // Today later on
            } else {
                for (let i = 1; i <= 7; i++) {
                    const nextDay = (currentDay + i) % 7;
                    if (activeDays.includes(nextDay)) {
                        targetDate.setDate(targetDate.getDate() + i);
                        break;
                    }
                }
            }
        }

        const diffMs = targetDate - now;
        if (diffMs <= 0) {
            diffEl.textContent = 'Alarm in --';
            return;
        }

        diffEl.textContent = formatTimeRemaining(diffMs);
    }

    ['new-alarm-hour', 'new-alarm-minute', 'new-alarm-ampm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateModalAlarmDiff);
    });

    addAlarmBtn.addEventListener('click', () => openAlarmModal());

    cancelAlarmBtn.addEventListener('click', () => {
        alarmModal.classList.remove('active');
        editingAlarmId = null;
    });

    modalDayPills.forEach(pill => {
        pill.addEventListener('click', () => {
            pill.classList.toggle('active');
            updateModalAlarmDiff();
        });
    });

    saveAlarmBtn.addEventListener('click', async () => {
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

        if (editingAlarmId !== null) {
            const index = alarms.findIndex(a => a.id === editingAlarmId);
            if (index !== -1) {
                alarms[index] = {
                    ...alarms[index],
                    time: time,
                    label: label,
                    sound: sound,
                    days: activeDays.length > 0 ? activeDays : [0, 1, 2, 3, 4, 5, 6]
                };
            }
        } else {
            const newAlarm = {
                id: generateValidAlarmId(),
                time: time,
                label: label,
                active: true,
                sound: sound,
                days: activeDays.length > 0 ? activeDays : [0, 1, 2, 3, 4, 5, 6]
            };
            alarms.push(newAlarm);
        }

        if (sound.startsWith('custom_') && pendingCustomAudioBlob) {
            try {
                await saveCustomAudio(sound, pendingCustomAudioBlob);
                await populateCustomSoundOptions();
            } catch (e) {
                console.error("Failed to save audio", e);
            }
        }

        saveAlarms();
        renderAlarms();
        alarmModal.classList.remove('active');
        
        // Reset modal
        document.getElementById('new-alarm-label').value = '';
        document.getElementById('new-alarm-sound').value = 'classic';
        modalDayPills.forEach(p => p.classList.remove('active'));
        pendingCustomAudioBlob = null;
        pendingCustomAudioName = null;
        editingAlarmId = null;
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
            
            const customId = `custom_${Date.now()}`;
            const customOption = document.createElement('option');
            customOption.value = customId;
            customOption.textContent = `Custom: ${file.name}`;
            soundSelect.insertBefore(customOption, soundSelect.querySelector('option[value="custom"]'));
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

    function stopAlarmService() {
        if (isCapacitor) {
            const CustomAlarm = window.Capacitor?.Plugins?.CustomAlarm;
            if (CustomAlarm) {
                CustomAlarm.stopService();
            }
        }
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
        let answer = 0;
        let problemText = "";
        
        const isComplex = (num) => {
            const s = String(num);
            // Rule 1: No simple numbers (ending in 0 or 5)
            if (num % 10 === 0 || num % 10 === 5) return false;
            // Rule 2: No repeating digits (e.g., 555, 666, 777, 888, 999)
            if (s[0] === s[1] && s[1] === s[2]) return false;
            return true;
        };

        let attempts = 0;
        while (attempts < 500) {
            attempts++;
            const format = Math.random() > 0.5 ? 'mult_add' : 'div_mult_add';
            
            if (format === 'mult_add') {
                const num1 = Math.floor(Math.random() * 15) + 6; // 6 to 20
                const num2 = Math.floor(Math.random() * 40) + 10; // 10 to 49
                const num3 = Math.floor(Math.random() * 400) + 50; // 50 to 449
                answer = (num1 * num2) + num3;
                problemText = `${num1} x ${num2} + ${num3} = ?`;
            } else {
                const num2 = Math.floor(Math.random() * 8) + 3; // divisor: 3 to 10
                const multiplier = Math.floor(Math.random() * 15) + 5; // division result: 5 to 19
                const num1 = num2 * multiplier; 
                const num3 = Math.floor(Math.random() * 30) + 10; // 10 to 39
                const num4 = Math.floor(Math.random() * 400) + 50; // 50 to 449
                answer = (num1 / num2) * num3 + num4;
                problemText = `(${num1} / ${num2}) x ${num3} + ${num4} = ?`;
            }

            if (answer >= 501 && answer <= 998 && isComplex(answer)) {
                break;
            }
        }
        
        currentMathAnswer = answer;
        mathProblemEl.textContent = problemText;
        mathAnswerEl.value = '';
    }

    let isTimerRinging = false;

    function triggerAlarm(alarm, isTimer = false) {
        initAudio();
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

        // Show system notification
        if ('Notification' in window && Notification.permission === 'granted') {
            const hDisplay = document.getElementById('ringing-time').textContent;
            new Notification(alarm.label || 'Alarm', {
                body: isTimer ? "Timer finished!" : `It's ${hDisplay}!`,
                icon: 'icon.png',
                vibrate: [200, 100, 200],
                requireInteraction: true
            });
        }
        
        if (!isTimer) {
            setTimeout(() => mathAnswerEl.focus(), 100);
        }
    }

    function attemptStopAlarm() {
        if (isTimerRinging) {
            ringingOverlay.classList.remove('active');
            stopAlarmSound();
            stopAlarmService();
            ringingAlarm = null;
            isTimerRinging = false;
            mathAnswerEl.value = '';
            return;
        }

        const userAnswer = parseInt(mathAnswerEl.value, 10);
        if (userAnswer === currentMathAnswer) {
            ringingOverlay.classList.remove('active');
            stopAlarmSound();
            stopAlarmService();
            if (ringingAlarm && ringingAlarm.active) {
                scheduleNativeAlarm(ringingAlarm);
            }
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
        updateAllAlarmCountdowns();
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
            
            cancelNativeTimer();
            localStorage.removeItem('tmEndTime');
            localStorage.removeItem('tmDuration');
            
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

    function saveTimerState() {
        if (tmRunning && tmEndTime > 0) {
            localStorage.setItem('tmEndTime', tmEndTime);
            localStorage.setItem('tmDuration', getSelectedTMDuration());
        } else {
            localStorage.removeItem('tmEndTime');
            localStorage.removeItem('tmDuration');
        }
    }

    tmStartPauseBtn.addEventListener('click', () => {
        if (tmRunning) {
            // Pause
            tmRunning = false;
            clearInterval(tmInterval);
            setButtonIcon(tmStartPauseBtn, 'play');
            cancelNativeTimer();
            saveTimerState();
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
            scheduleNativeTimer(tmEndTime);
            saveTimerState();
        }
        lucide.createIcons();
    });

    tmCancelBtn.addEventListener('click', () => {
        tmRunning = false;
        clearInterval(tmInterval);
        cancelNativeTimer();
        localStorage.removeItem('tmEndTime');
        localStorage.removeItem('tmDuration');
        resetTimerUI();
    });

    function restoreTimerState() {
        const savedEndTime = localStorage.getItem('tmEndTime');
        if (savedEndTime) {
            const endTime = parseInt(savedEndTime, 10);
            const remaining = endTime - Date.now();
            if (remaining > 0) {
                tmRunning = true;
                tmEndTime = endTime;
                tmRemaining = remaining;
                tmInputContainer.classList.add('hidden');
                tmDisplay.classList.remove('hidden');
                tmCancelBtn.disabled = false;
                tmDisplay.textContent = formatTimeTM(tmRemaining);
                tmInterval = setInterval(updateTMDisplay, 50);
                setButtonIcon(tmStartPauseBtn, 'pause');
                lucide.createIcons();
                scheduleNativeTimer(tmEndTime);
            } else {
                localStorage.removeItem('tmEndTime');
                localStorage.removeItem('tmDuration');
            }
        }
    }

    // --- Initialization ---
    populateCustomSoundOptions().then(() => {
        renderAlarms();
    });
    renderWorldClocks();
    restoreTimerState();
    setInterval(updateClocks, 1000);
});
