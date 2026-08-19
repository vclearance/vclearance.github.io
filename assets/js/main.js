        // 1. Импортируем нужные функции из официального CDN Firebase + функции для запросов (query, orderBy, limit)
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
        import { getFirestore, doc, getDoc, setDoc, addDoc, collection, onSnapshot, deleteDoc, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

        // 2. Конфигурация проекта из вкладки CDN
        const firebaseConfig = {
            apiKey: "AIzaSyCa2nr-heFF5LqoqN_tPYGJpf9PGhqMydo",
            authDomain: "vclearance-15b43.firebaseapp.com",
            projectId: "vclearance-15b43",
            storageBucket: "vclearance-15b43.firebasestorage.app",
            messagingSenderId: "299361728910",
            appId: "1:299361728910:web:7e77b2f4431db23a66ccdf"
        };

        // 3. Инициализация приложения и базы данных
        const app = initializeApp(firebaseConfig);
        const db = getFirestore(app);

        // === СОСТОЯНИЕ АВТОРИЗАЦИИ АДМИНОВ И ЛОГОВ ===
        window.currentAdminRole = null;
        window.currentAdminCid = null;
        window.showSystemLogs = false; // Переменная для хранения состояния чекбокса
        const ADMIN_CACHE_KEY = 'va_admin_cache';

        window.rosterLimit = 3;
        window.currentAuditDocs = null;

        // === СЛЕЖЕНИЕ ЗА НЕПРОЧИТАННЫМ ОТВЕТОМ ПОДДЕРЖКИ И ЛС (для красного кружка на кнопке профиля) ===
        let unsubUnreadDot = null;
        let unsubUnreadDmDot = null;
        let unreadDotCid = null;
        let supportUnreadFlag = false;
        let dmUnreadFlag = false;
        function watchUnreadSupportDot(cid) {
            if (unreadDotCid === cid && unsubUnreadDot) return;
            if (unsubUnreadDot) { unsubUnreadDot(); unsubUnreadDot = null; }
            if (unsubUnreadDmDot) { unsubUnreadDmDot(); unsubUnreadDmDot = null; }
            unreadDotCid = cid;
            supportUnreadFlag = false;
            dmUnreadFlag = false;
            if (!cid) { setUnreadDotVisible(false); return; }
            unsubUnreadDot = onSnapshot(doc(db, 'chat_threads', cid.toString()), snap => {
                const data = snap.exists() ? snap.data() : null;
                supportUnreadFlag = !!(data && data.unreadForUser);
                setUnreadDotVisible(supportUnreadFlag || dmUnreadFlag);
            });
            unsubUnreadDmDot = onSnapshot(query(collection(db, 'dm_threads'), where('participants', 'array-contains', cid.toString())), snap => {
                dmUnreadFlag = snap.docs.some(d => {
                    const data = d.data();
                    return !!(data && data.unread && data.unread[cid.toString()]);
                });
                setUnreadDotVisible(supportUnreadFlag || dmUnreadFlag);
            });
        }
        function setUnreadDotVisible(visible) {
            document.getElementById('profileUnreadDot')?.classList.toggle('show', visible);
            document.getElementById('cabinetUnreadDot')?.classList.toggle('show', visible);
        }

        // --- Вспомогательная функция для логирования в Журнал Аудита ---
        window.logAudit = async function(action, details) {
            if (!window.currentAdminCid) return;
            try {
                await addDoc(collection(db, 'audit_logs'), {
                    timestamp: new Date().toISOString(),
                    adminCid: window.currentAdminCid,
                    action: action,
                    details: details
                });
            } catch (error) {
                console.error("Ошибка записи в аудит:", error);
            }
        };

        // --- Переключатель отображения системных логов ---
        window.toggleSystemLogs = function(isChecked) {
            window.showSystemLogs = isChecked;
            window.renderAuditLogs();
        };

        // --- Слушатель для Журнала Аудита ---
        // ВАЖНО: раньше этот слушатель запускался в initApp() для КАЖДОГО посетителя сайта
        // (даже неавторизованных) и читал ВСЮ коллекцию audit_logs целиком без лимита —
        // именно это стало главной причиной резкого роста чтений Firestore (2М+ в день).
        // Теперь слушатель запускается только когда Основатель/Админ реально открывает
        // Панель Управления, ограничен последними 300 записями и отписывается при закрытии.
        let unsubAuditLogs = null;
        function listenToAuditLogs() {
            if (unsubAuditLogs) return; // уже подписаны — не плодим повторные слушатели
            const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(300));
            unsubAuditLogs = onSnapshot(q, (snapshot) => {
                window.currentAuditDocs = snapshot;
                window.renderAuditLogs();
            });
        }
        function stopListeningToAuditLogs() {
            if (unsubAuditLogs) { unsubAuditLogs(); unsubAuditLogs = null; }
            window.currentAuditDocs = null;
        }

        window.renderAuditLogs = function() {
            const tbody = document.getElementById('audit-tbody');
            if (!tbody || !window.currentAuditDocs) return;
            tbody.innerHTML = '';
            
            if (window.currentAuditDocs.empty) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#666;">Журнал пуст</td></tr>`;
                return;
            }

            let renderedCount = 0;

            window.currentAuditDocs.forEach(docSnap => {
                const data = docSnap.data();
                
                // Пропускаем системные сообщения, если галочка не стоит
                const isSystemLog = data.adminCid === 'Система (Бот)';
                if (isSystemLog && !window.showSystemLogs) {
                    return; 
                }

                const logId = docSnap.id;
                const dateObj = new Date(data.timestamp);
                const dateStr = dateObj.toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
                
                let deleteBtnHtml = '';
                if (window.currentAdminRole === 'founder') {
                    deleteBtnHtml = `<button onclick="window.deleteAuditLog('${logId}')" style="background: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3); padding: 2px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; margin-left: 8px;" title="Удалить лог">Удалить</button>`;
                }
                
                const adminDisplay = isSystemLog 
                    ? `<strong style="color:#3498db;">${data.adminCid}</strong>` 
                    : `<strong style="color:#2ecc71;">${data.adminCid}</strong>`;

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="color:#aaa;">${dateStr}</td>
                    <td>${adminDisplay}</td>
                    <td>${data.action}: <span style="color:#ccc;">${data.details}</span> ${deleteBtnHtml}</td>
                `;
                tbody.appendChild(tr);
                renderedCount++;
            });

            if (renderedCount === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#666;">Нет записей для отображения</td></tr>`;
            }
        }

        window.deleteAuditLog = async function(logId) {
            if (window.currentAdminRole !== 'founder') {
                alert('Удаление логов доступно только Основателю!');
                return;
            }
            if (confirm('Вы уверены, что хотите удалить эту запись из логов?')) {
                try {
                    await deleteDoc(doc(db, 'audit_logs', logId));
                } catch (error) {
                    console.error('Ошибка при удалении лога:', error);
                    alert('Не удалось удалить запись из логов.');
                }
            }
        };

        window.showMorePilots = function() {
            window.rosterLimit += 10;
            if (window.lastVatsimData) {
                renderRoster(window.lastVatsimData);
            } else {
                renderRoster({ pilots: [], controllers: [] });
            }
        };

        const BASE_PILOTS = [
            { cid: "1816284", name: "Karim I." }
        ];

        window.MY_PILOTS = [...BASE_PILOTS];
        window.firebaseFlightsCache = {};

        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const navContainer = document.getElementById('navContainer');
        const rosterTbody = document.getElementById('roster-tbody');

        let currentLang = 'ru';
        window.lastVatsimData = null;
        window.openPilotCid = null;

        window.recentFlightsData = [];
        window.currentRecentPage = 1;
        window.currentDashboardRecentPage = 1;
        window.currentDashboardTimeRange = 'all';
        window.pendingPasswordChangeCid = null;
        const DASHBOARD_FLIGHTS_PER_PAGE = 50;
        const FLIGHTS_PER_PAGE = 10;

        // Склонение слова "вылет" по числу (1 вылет, 2 вылета, 5 вылетов).
        function pluralizeFlights(n) {
            const mod10 = n % 10;
            const mod100 = n % 100;
            if (mod10 === 1 && mod100 !== 11) return 'вылет';
            if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'вылета';
            return 'вылетов';
        }

        function cleanAircraftType(aircraftStr) {
            if (!aircraftStr) return '---';
            if (aircraftStr.includes('/')) {
                return aircraftStr.split('/')[0].trim();
            }
            return aircraftStr.trim();
        }

        mobileMenuBtn.addEventListener('click', () => {
            mobileMenuBtn.classList.toggle('active');
            navContainer.classList.toggle('active');
        });

        window.closeMenu = function() {
            mobileMenuBtn.classList.remove('active');
            navContainer.classList.remove('active');
            document.getElementById('langDropdown').classList.remove('active');
        };

        window.toggleMobileLang = function(e) {
            if (window.innerWidth <= 768) {
                e.preventDefault();
                document.getElementById('langDropdown').classList.toggle('active');
            } else {
                document.getElementById('langDropdown').classList.toggle('active');
            }
        };

        window.changeLanguage = function(lang) {
            currentLang = lang;
            const flag = lang === 'ru' ? '🇷🇺' : '🇬🇧';
            document.getElementById('currentFlag').textContent = flag;
            document.getElementById('currentText').textContent = lang.toUpperCase();
            
            document.querySelectorAll('.lang').forEach(el => {
                if (lang === 'en') {
                    if (el.id === 'privacyAtcPara') el.innerHTML = el.getAttribute('data-en');
                    else el.textContent = el.getAttribute('data-en');
                } else {
                    if (el.id === 'privacyAtcPara') el.innerHTML = el.getAttribute('data-ru');
                    else el.textContent = el.getAttribute('data-ru');
                }
            });

            if (window.lastVatsimData) renderRoster(window.lastVatsimData);
            else renderRoster({ pilots: [], controllers: [] });
            
            renderRecentFlights();
            window.renderEventsCarousel(); 
            window.renderLiveriesPublic();
            window.updateProfileWidget();
            if (window.innerWidth <= 768) closeMenu();
        };

        window.highlightCard = function(cardId) {
            closeMenu();
            setTimeout(() => {
                const targetCard = document.getElementById(cardId);
                if (targetCard) {
                    targetCard.classList.remove('highlight-target');
                    void targetCard.offsetWidth;
                    targetCard.classList.add('highlight-target');
                }
            }, 100);
        };

        window.highlightItsMeButtons = function() {
            const dropdown = document.getElementById('profileDropdown');
            if (dropdown) dropdown.classList.remove('active');
            if (window.innerWidth <= 768) closeMenu();

            const rosterSection = document.getElementById('roster');

            // Сайт теперь многостраничный: если секция с ростером есть на
            // текущей странице — просто скроллим к ней. Если её нет (мы на
            // другой странице), переходим на roster.html и просим её саму
            // подсветить кнопки "Это я" сразу после загрузки.
            if (rosterSection) {
                rosterSection.scrollIntoView({ behavior: 'smooth' });
                setTimeout(() => {
                    document.querySelectorAll('.btn-its-me').forEach(btn => {
                        btn.classList.remove('highlight-target');
                        void btn.offsetWidth;
                        btn.classList.add('highlight-target');
                    });
                }, 300);
            } else {
                sessionStorage.setItem('vc_highlight_its_me', '1');
                window.location.href = 'roster.html';
            }
        };

        // Если мы попали на roster.html через "Забыли свой CID?" с другой
        // страницы — подсвечиваем кнопки "Это я" после того, как ростер
        // отрисуется в первый раз.
        window._checkPendingHighlight = function() {
            if (sessionStorage.getItem('vc_highlight_its_me') === '1') {
                sessionStorage.removeItem('vc_highlight_its_me');
                setTimeout(() => {
                    document.querySelectorAll('.btn-its-me').forEach(btn => {
                        btn.classList.remove('highlight-target');
                        void btn.offsetWidth;
                        btn.classList.add('highlight-target');
                    });
                }, 500);
            }
        };

        function listenToPilots() {
            onSnapshot(collection(db, 'custom_pilots'), (snapshot) => {
                let customPilots = [];
                snapshot.forEach((doc) => {
                    customPilots.push(doc.data());
                });
                window.MY_PILOTS = [...BASE_PILOTS, ...customPilots];
                if (window.lastVatsimData) renderRoster(window.lastVatsimData);
                else renderRoster({ pilots: [], controllers: [] });
            });
        }

        window.adminsMap = {};
        function listenToAdmins() {
            onSnapshot(collection(db, 'admins'), (snapshot) => {
                const map = {};
                snapshot.forEach((docSnap) => {
                    map[docSnap.id] = docSnap.data().role || 'admin';
                });
                window.adminsMap = map;
                if (window.lastVatsimData) renderRoster(window.lastVatsimData);
                else renderRoster({ pilots: [], controllers: [] });
            });
        }

        // --- Блокировки мессенджера (только Основатель может блокировать/разблокировать) ---
        // messenger_blocks/{cid}: { blockAt: ISO-время, setBy, setAt }
        // Блокировка вступает в силу не сразу, а через 10 секунд после нажатия —
        // это время хранится в blockAt, а реальный статус (ещё "в ожидании" или уже
        // "активна") вычисляется на лету сравнением blockAt с текущим временем
        // (см. window.getMessengerBlockStatus), поскольку сайт статический и не
        // имеет сервера/крона, который мог бы сработать ровно через 10 секунд.
        window.messengerBlocksMap = {};
        function listenToMessengerBlocks() {
            onSnapshot(collection(db, 'messenger_blocks'), (snapshot) => {
                const map = {};
                snapshot.forEach((docSnap) => {
                    map[docSnap.id] = docSnap.data();
                });
                window.messengerBlocksMap = map;
                if (window.lastVatsimData) renderRoster(window.lastVatsimData);
                else renderRoster({ pilots: [], controllers: [] });
            });
        }

        // Возвращает текущий статус блокировки мессенджера для CID:
        // { none: true } — блокировки нет;
        // { pending: true, blockAt, msLeft } — блокировка назначена, но 10 секунд ещё не прошли;
        // { active: true, blockAt } — блокировка уже вступила в силу.
        window.getMessengerBlockStatus = function(cid) {
            const info = window.messengerBlocksMap ? window.messengerBlocksMap[cid.toString()] : null;
            if (!info || !info.blockAt) return { none: true };
            const blockAtMs = new Date(info.blockAt).getTime();
            const msLeft = blockAtMs - Date.now();
            if (msLeft <= 0) return { active: true, blockAt: info.blockAt, info };
            return { pending: true, blockAt: info.blockAt, msLeft, info };
        };

        window.blockPilotMessenger = async function(cid, name) {
            if (!window.isFounder()) {
                alert('Только Основатель может блокировать мессенджер!');
                return;
            }
            const cidStr = cid.toString();
            if (!confirm(`Заблокировать мессенджер для ${name || ('CID ' + cidStr)}?\n\nБлокировка вступит в силу через 10 секунд.`)) return;
            try {
                const blockAt = new Date(Date.now() + 10 * 1000).toISOString();
                await setDoc(doc(db, 'messenger_blocks', cidStr), {
                    blockAt,
                    setBy: localStorage.getItem('vatsim_pilot_cid') || null,
                    setAt: new Date().toISOString()
                });
                await window.logAudit('Блокировка мессенджера', `CID: ${cidStr} (вступит в силу через 10 секунд)`);
            } catch (error) {
                console.error('Ошибка блокировки мессенджера:', error);
                alert('Произошла ошибка при блокировке мессенджера.');
            }
        };

        window.unblockPilotMessenger = async function(cid) {
            if (!window.isFounder()) {
                alert('Только Основатель может снимать блокировку мессенджера!');
                return;
            }
            try {
                await deleteDoc(doc(db, 'messenger_blocks', cid.toString()));
                await window.logAudit('Снятие блокировки мессенджера', `CID: ${cid}`);
            } catch (error) {
                console.error('Ошибка снятия блокировки мессенджера:', error);
                alert('Произошла ошибка при снятии блокировки мессенджера.');
            }
        };

        // --- Блокировки чата поддержки (та же логика, отдельная коллекция) ---
        // support_blocks/{cid}: { blockAt: ISO-время, setBy, setAt }
        // Блокирует вкладку «Связь с администрацией» в личном кабинете (не мессенджер).
        window.supportBlocksMap = {};
        function listenToSupportBlocks() {
            onSnapshot(collection(db, 'support_blocks'), (snapshot) => {
                const map = {};
                snapshot.forEach((docSnap) => {
                    map[docSnap.id] = docSnap.data();
                });
                window.supportBlocksMap = map;
                if (window.lastVatsimData) renderRoster(window.lastVatsimData);
                else renderRoster({ pilots: [], controllers: [] });
            });
        }

        window.getSupportBlockStatus = function(cid) {
            const info = window.supportBlocksMap ? window.supportBlocksMap[cid.toString()] : null;
            if (!info || !info.blockAt) return { none: true };
            const blockAtMs = new Date(info.blockAt).getTime();
            const msLeft = blockAtMs - Date.now();
            if (msLeft <= 0) return { active: true, blockAt: info.blockAt, info };
            return { pending: true, blockAt: info.blockAt, msLeft, info };
        };

        window.blockPilotSupport = async function(cid, name) {
            if (!window.isFounder()) {
                alert('Только Основатель может блокировать поддержку!');
                return;
            }
            const cidStr = cid.toString();
            if (!confirm(`Заблокировать чат поддержки для ${name || ('CID ' + cidStr)}?\n\nБлокировка вступит в силу через 10 секунд.`)) return;
            try {
                const blockAt = new Date(Date.now() + 10 * 1000).toISOString();
                await setDoc(doc(db, 'support_blocks', cidStr), {
                    blockAt,
                    setBy: localStorage.getItem('vatsim_pilot_cid') || null,
                    setAt: new Date().toISOString()
                });
                await window.logAudit('Блокировка поддержки', `CID: ${cidStr} (вступит в силу через 10 секунд)`);
            } catch (error) {
                console.error('Ошибка блокировки поддержки:', error);
                alert('Произошла ошибка при блокировке поддержки.');
            }
        };

        window.unblockPilotSupport = async function(cid) {
            if (!window.isFounder()) {
                alert('Только Основатель может снимать блокировку поддержки!');
                return;
            }
            try {
                await deleteDoc(doc(db, 'support_blocks', cid.toString()));
                await window.logAudit('Снятие блокировки поддержки', `CID: ${cid}`);
            } catch (error) {
                console.error('Ошибка снятия блокировки поддержки:', error);
                alert('Произошла ошибка при снятии блокировки поддержки.');
            }
        };

        // --- Discord-теги пилотов (видно только администраторам) ---
        window.discordMap = {};
        function listenToPilotDiscord() {
            onSnapshot(collection(db, 'pilot_discord'), (snapshot) => {
                const map = {};
                snapshot.forEach((docSnap) => {
                    map[docSnap.id] = docSnap.data().discord || '';
                });
                window.discordMap = map;
                if (window.lastVatsimData) renderRoster(window.lastVatsimData);
                else renderRoster({ pilots: [], controllers: [] });
            });
        }

        window.editPilotDiscord = function(cid) {
            if (!window.isAdmin()) return;
            // Открываем панель деталей пилота (она нужна для показа поля ввода),
            // на случай если действие запущено через ПКМ, а не через клик по строке.
            const detailsRow = document.getElementById(`details-${cid}`);
            if (detailsRow && !detailsRow.classList.contains('open')) {
                document.querySelectorAll('.pilot-details-row').forEach(r => r.classList.remove('open'));
                document.querySelectorAll('.pilot-row-clickable').forEach(r => r.classList.remove('active'));
                detailsRow.classList.add('open');
                window.openPilotCid = cid;
            }
            const container = document.getElementById(`discordValue-${cid}`);
            if (!container) return;
            const currentValue = window.discordMap ? (window.discordMap[cid.toString()] || '') : '';
            const safeValue = currentValue.replace(/"/g, '&quot;');
            container.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px;">
                    <input type="text" id="discordInput-${cid}" value="${safeValue}" placeholder="username#0000" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 13px; width: 150px;">
                    <button class="livery-admin-btn edit" title="Сохранить" onclick="event.stopPropagation(); window.savePilotDiscord('${cid}')">💾</button>
                    <button class="livery-admin-btn del" title="Отмена" onclick="event.stopPropagation(); window.cancelPilotDiscordEdit('${cid}')">✕</button>
                </div>
            `;
            const inputEl = document.getElementById(`discordInput-${cid}`);
            if (inputEl) {
                inputEl.addEventListener('click', (e) => e.stopPropagation());
                inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); window.savePilotDiscord(cid); }
                    if (e.key === 'Escape') { e.preventDefault(); window.cancelPilotDiscordEdit(cid); }
                });
                inputEl.focus();
            }
        };

        window.cancelPilotDiscordEdit = function(cid) {
            if (window.lastVatsimData) renderRoster(window.lastVatsimData);
            else renderRoster({ pilots: [], controllers: [] });
        };

        window.savePilotDiscord = async function(cid) {
            if (!window.isAdmin()) return;
            const inputEl = document.getElementById(`discordInput-${cid}`);
            if (!inputEl) return;
            const value = inputEl.value.trim();
            try {
                if (!value) {
                    await deleteDoc(doc(db, 'pilot_discord', cid.toString()));
                    window.logAudit('discord_remove', `CID ${cid}`);
                } else {
                    await setDoc(doc(db, 'pilot_discord', cid.toString()), { discord: value }, { merge: true });
                    window.logAudit('discord_set', `CID ${cid} -> ${value}`);
                }
            } catch (error) {
                console.error('Ошибка сохранения Discord:', error);
                alert('Не удалось сохранить Discord. Попробуйте еще раз.');
            }
        };

        window.deletePilotDiscord = async function(cid) {
            if (!window.isAdmin()) return;
            if (!confirm('Удалить Discord этого пилота?')) return;
            try {
                await deleteDoc(doc(db, 'pilot_discord', cid.toString()));
                window.logAudit('discord_remove', `CID ${cid}`);
            } catch (error) {
                console.error('Ошибка удаления Discord:', error);
                alert('Не удалось удалить Discord. Попробуйте еще раз.');
            }
        };

        // Пароль конкретного пилота запрашивается из Firebase только в момент
        // клика на глазик (а не хранится заранее в памяти у всех посетителей сайта),
        // и повторный клик снова скрывает его без нового запроса.
        window.togglePilotPasswordVisibility = async function(cid) {
            if (!window.isAdmin()) return;
            const valEl = document.getElementById(`pwdValue-${cid}`);
            const eyeBtn = document.getElementById(`pwdEyeBtn-${cid}`);
            const copyBtn = document.getElementById(`pwdCopyBtn-${cid}`);
            if (!valEl) return;

            if (valEl.dataset.revealed === 'true') {
                valEl.textContent = '••••••••';
                delete valEl.dataset.password;
                valEl.dataset.revealed = 'false';
                if (eyeBtn) eyeBtn.textContent = '👁️';
                if (copyBtn) copyBtn.style.display = 'none';
                return;
            }

            if (eyeBtn) eyeBtn.disabled = true;
            try {
                const snap = await getDoc(doc(db, 'pilot_auth', cid.toString()));
                if (!snap.exists() || !snap.data().password) {
                    valEl.textContent = 'нет пароля';
                    if (copyBtn) copyBtn.style.display = 'none';
                } else {
                    const pwd = snap.data().password;
                    valEl.textContent = pwd;
                    valEl.dataset.password = pwd;
                    valEl.dataset.revealed = 'true';
                    if (eyeBtn) eyeBtn.textContent = '🙈';
                    if (copyBtn) copyBtn.style.display = 'inline-flex';
                }
            } catch (error) {
                console.error('Ошибка получения пароля:', error);
                valEl.textContent = '••••••••';
            } finally {
                if (eyeBtn) eyeBtn.disabled = false;
            }
        };

        window.copyPilotPassword = function(cid) {
            if (!window.isAdmin()) return;
            const valEl = document.getElementById(`pwdValue-${cid}`);
            const copyBtn = document.getElementById(`pwdCopyBtn-${cid}`);
            if (!valEl) return;
            const pwd = valEl.dataset.password || '';
            if (!pwd) return;

            const flashCopied = () => {
                if (!copyBtn) return;
                const original = copyBtn.textContent;
                copyBtn.textContent = '✅';
                setTimeout(() => { copyBtn.textContent = original; }, 1200);
            };

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(pwd).then(flashCopied).catch(() => {
                    alert('Не удалось скопировать пароль.');
                });
            } else {
                const temp = document.createElement('textarea');
                temp.value = pwd;
                temp.style.position = 'fixed';
                temp.style.opacity = '0';
                document.body.appendChild(temp);
                temp.focus();
                temp.select();
                try {
                    document.execCommand('copy');
                    flashCopied();
                } catch (e) {
                    console.error('Не удалось скопировать пароль:', e);
                }
                document.body.removeChild(temp);
            }
        };

        // ================= ИВЕНТЫ: СЛУШАТЕЛЬ И ЛОГИКА КАРУСЕЛИ =================
        window.allEvents = [];
        window.currentEventIndex = 0;
        window._eventsInitialized = false;

        function listenToEvents() {
            onSnapshot(collection(db, 'events'), (snapshot) => {
                let events = [];
                snapshot.forEach(doc => {
                    let data = doc.data();
                    data.id = doc.id;
                    events.push(data);
                });
                
                events.sort((a, b) => new Date(a.date) - new Date(b.date));
                window.allEvents = events;

                const now = new Date();
                let closestIndex = events.findIndex(e => new Date(e.date) >= now);
                if (closestIndex === -1 && events.length > 0) {
                    closestIndex = events.length - 1; 
                } else if (events.length === 0) {
                    closestIndex = 0;
                }
                
                if (!window._eventsInitialized || window.currentEventIndex >= events.length || window.allEvents.length === 0) {
                    window.currentEventIndex = closestIndex !== -1 ? closestIndex : 0;
                    if (window.allEvents.length > 0) window._eventsInitialized = true;
                }
                
                window.renderEventsCarousel();
            });
        }

        window.renderEventsCarousel = function() {
            const container = document.getElementById('eventCarouselContainer');
            const adminBtns = document.getElementById('eventAdminBtns');
            if (!container || !adminBtns) return;

            if (window.isAdmin()) {
                let delBtn = window.allEvents.length > 0 ? `<button onclick="window.deleteCurrentEvent()" class="btn-event-admin btn-event-del">Удалить текущий</button>` : '';
                adminBtns.innerHTML = `
                    <button onclick="window.openAddEventModal()" class="btn-event-admin btn-event-add">+ Добавить ивент</button>
                    ${delBtn}
                `;
            } else {
                adminBtns.innerHTML = '';
            }

            if (window.allEvents.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; color: #555; padding: 40px 0; background: rgba(20,20,20,0.3); border-radius: 12px; border: 1px solid rgba(255,255,255,0.02); width: 100%;" class="lang" data-ru="События пока не запланированы" data-en="No events scheduled yet.">
                        ${currentLang === 'en' ? 'No events scheduled yet.' : 'События пока не запланированы'}
                    </div>
                `;
                return;
            }

            let html = '<div class="carousel-track">';
            
            const now = new Date();
            let closestFutureIndex = window.allEvents.findIndex(e => new Date(e.date) >= now);

            window.allEvents.forEach((ev, index) => {
                let positionClass = '';
                if (index === window.currentEventIndex) positionClass = 'slide-center';
                else if (index === window.currentEventIndex - 1) positionClass = 'slide-left';
                else if (index === window.currentEventIndex + 1) positionClass = 'slide-right';
                else if (index < window.currentEventIndex) positionClass = 'slide-hidden-left';
                else positionClass = 'slide-hidden-right';

                let badgeHtml = '';
                if (index === closestFutureIndex) {
                    badgeHtml = `<div class="event-badge">${currentLang === 'en' ? 'NEXT EVENT' : 'БЛИЖАЙШИЙ'}</div>`;
                } else if (new Date(ev.date) < now) {
                    badgeHtml = `<div class="event-badge badge-past">${currentLang === 'en' ? 'PAST' : 'ПРОШЕЛ'}</div>`;
                }

                const imgSrc = ev.img && ev.img.trim() !== '' ? ev.img : 'https://i.imgur.com/kFSOdpY.png';
                
                const dateObj = new Date(ev.date);
                const eventDateFormatted = dateObj.toLocaleString(currentLang === 'en' ? 'en-GB' : 'ru-RU', {
                    timeZone: 'UTC',
                    day: '2-digit', month: 'long', year: 'numeric', 
                    hour: '2-digit', minute: '2-digit'
                }).replace(',', '') + 'z';

                html += `
                    <div class="event-card ${positionClass}" onclick="window.setEventIndex(${index})">
                        ${badgeHtml}
                        <img src="${imgSrc}" alt="${ev.title}">
                        <div class="event-card-content">
                            <div class="event-card-header">
                                <h3>${ev.title}</h3>
                                <span class="event-route-badge">${ev.route}</span>
                            </div>
                            <div class="event-date">📅 ${eventDateFormatted}</div>
                            <p>${ev.desc}</p>
                        </div>
                    </div>
                `;
            });
            html += '</div>';

            if (window.allEvents.length > 1) {
                html += `
                    <div class="carousel-controls">
                        <button onclick="window.changeEventIndex(-1)" ${window.currentEventIndex === 0 ? 'disabled' : ''}>&#10094;</button>
                        <button onclick="window.changeEventIndex(1)" ${window.currentEventIndex === window.allEvents.length - 1 ? 'disabled' : ''}>&#10095;</button>
                    </div>
                `;
            }

            container.innerHTML = html;
        };

        window.setEventIndex = function(index) {
            if(index >= 0 && index < window.allEvents.length) {
                window.currentEventIndex = index;
                window.renderEventsCarousel();
            }
        };

        window.changeEventIndex = function(dir) {
            window.setEventIndex(window.currentEventIndex + dir);
        };

        window.openAddEventModal = function() {
            document.getElementById('addEventModal').classList.add('open');
        };

        window.submitNewEvent = async function() {
            const dateVal = document.getElementById('eventDate').value; 
            const img = document.getElementById('eventImg').value.trim();
            const title = document.getElementById('eventTitle').value.trim();
            const route = document.getElementById('eventRoute').value.trim();
            const desc = document.getElementById('eventDesc').value.trim();
            
            if(!dateVal || !title || !route || !desc) {
                alert('Поля Дата, Заголовок, Маршрут и Описание обязательны к заполнению!');
                return;
            }
            
            const date = dateVal + 'Z';
            
            const eventData = { date, img, title, route, desc, addedAt: new Date().toISOString() };
            
            try {
                await addDoc(collection(db, 'events'), eventData);
                await window.logAudit('Добавление ивента', `Название: "${title}", Маршрут: ${route}`);
                
                document.getElementById('eventDate').value = '';
                document.getElementById('eventImg').value = '';
                document.getElementById('eventTitle').value = '';
                document.getElementById('eventRoute').value = '';
                document.getElementById('eventDesc').value = '';
                document.getElementById('addEventModal').classList.remove('open');
            } catch (error) {
                console.error("Ошибка сохранения ивента:", error);
                alert("Произошла ошибка при публикации.");
            }
        };

        window.deleteCurrentEvent = async function() {
            const ev = window.allEvents[window.currentEventIndex];
            if (!ev) return;
            
            if (confirm(`Вы уверены, что хотите удалить ивент: "${ev.title}"?`)) {
                try {
                    await deleteDoc(doc(db, 'events', ev.id));
                    await window.logAudit('Удаление ивента', `Название: "${ev.title}"`);
                    
                    if (window.currentEventIndex > 0) {
                        window.currentEventIndex--;
                    }
                } catch (error) {
                    console.error("Ошибка удаления ивента:", error);
                    alert("Произошла ошибка при удалении.");
                }
            }
        };

        // ================= ЛИВРЕИ =================
        window.allLiveries = [];
        window.editingLiveryId = null;

        function escapeHtml(str) {
            if (str === undefined || str === null) return '';
            return String(str)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function safeUrl(url) {
            const u = (url || '').trim();
            if (/^https?:\/\//i.test(u)) return u;
            return '#';
        }

        function listenToLiveries() {
            onSnapshot(collection(db, 'liveries'), (snapshot) => {
                let liveries = [];
                snapshot.forEach(docSnap => {
                    liveries.push({ id: docSnap.id, ...docSnap.data() });
                });
                liveries.sort((a, b) => (a.aircraft || '').localeCompare(b.aircraft || '')) ;
                window.allLiveries = liveries;
                window.renderLiveriesPublic();
                window.renderLiveriesAdminList();
            }, (error) => {
                console.error('Ошибка чтения ливрей из Firebase:', error);
            });
        }

        window.renderLiveriesPublic = function() {
            const grid = document.getElementById('liveriesGrid');
            if (!grid) return;

            const adminBar = document.getElementById('fleetLiveryAdminBar');
            if (adminBar) adminBar.style.display = (window.canManageLiveries && window.canManageLiveries()) ? 'flex' : 'none';

            if (window.allLiveries.length === 0) {
                grid.innerHTML = `<div class="livery-empty">${currentLang === 'en' ? 'No liveries added yet.' : 'Ливреи пока не добавлены'}</div>`;
                return;
            }

            const canManage = window.canManageLiveries && window.canManageLiveries();

            let html = '';
            window.allLiveries.forEach(liv => {
                const img = liv.img && liv.img.trim() !== '' ? liv.img : 'https://i.imgur.com/kFSOdpY.png';
                const sources = Array.isArray(liv.sources) ? liv.sources : [];
                const sourcesHtml = sources.map(src => {
                    const text = escapeHtml(src.text && src.text.trim() !== '' ? src.text : 'Скачать');
                    return `<a href="${safeUrl(src.link)}" target="_blank" rel="noopener noreferrer" class="livery-source-link">${text}</a>`;
                }).join('');

                const outdatedClass = liv.outdated ? ' outdated' : '';
                const outdatedBadge = liv.outdated
                    ? `<div class="livery-outdated-badge">${currentLang === 'en' ? 'Outdated' : 'Устаревшая'}</div>`
                    : '';

                const manageButtons = canManage
                    ? `<div class="livery-admin-actions" style="margin-top:8px;">
                            <button class="livery-admin-btn edit" title="Изменить" onclick="window.openEditLiveryModal('${liv.id}')">✏️</button>
                            <button class="livery-admin-btn del" title="Удалить" onclick="window.deleteLivery('${liv.id}')">🗑️</button>
                       </div>`
                    : '';

                html += `
                    <div class="card livery-card${outdatedClass}">
                        ${outdatedBadge}
                        <div class="livery-photo-wrap"><img src="${escapeHtml(img)}" alt="${escapeHtml(liv.title)}" loading="lazy"></div>
                        <div class="livery-body">
                            <div class="livery-aircraft">${escapeHtml(liv.aircraft)}</div>
                            <div class="livery-title">${escapeHtml(liv.title)}</div>
                            <div class="livery-sources">${sourcesHtml}</div>
                            ${manageButtons}
                        </div>
                    </div>
                `;
            });
            grid.innerHTML = html;
        };

        window.renderLiveriesAdminList = function() {
            const list = document.getElementById('liveriesAdminList');
            if (!list) return;

            if (!window.canManageLiveries()) {
                list.innerHTML = `<div style="text-align:center; color:#666; padding: 15px; font-size: 12px;">Доступно только администраторам.</div>`;
                return;
            }

            if (window.allLiveries.length === 0) {
                list.innerHTML = `<div style="text-align:center; color:#666; padding: 15px; font-size: 12px;">Ливреи пока не добавлены.</div>`;
                return;
            }

            let html = '';
            window.allLiveries.forEach(liv => {
                const outdatedTag = liv.outdated ? ' <span style="color:#ff8080; font-weight:700;">[устар.]</span>' : '';
                html += `
                    <div class="livery-admin-row">
                        <span class="livery-admin-name">${escapeHtml(liv.title)} <span>(${escapeHtml(liv.aircraft)})</span>${outdatedTag}</span>
                        <div class="livery-admin-actions">
                            <button class="livery-admin-btn edit" title="Изменить" onclick="window.openEditLiveryModal('${liv.id}')">✏️</button>
                            <button class="livery-admin-btn del" title="Удалить" onclick="window.deleteLivery('${liv.id}')">🗑️</button>
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
        };

        window.addLiverySourceRow = function(text, link) {
            const container = document.getElementById('liverySourcesContainer');
            const row = document.createElement('div');
            row.className = 'livery-source-row';
            row.innerHTML = `
                <input type="text" class="livery-source-text" placeholder="Текст (например, Скачать с сайта)" value="${escapeHtml(text || '')}">
                <input type="text" class="livery-source-link" placeholder="https://..." value="${escapeHtml(link || '')}">
                <button type="button" class="remove-source-btn" onclick="this.parentElement.remove()">✕</button>
            `;
            container.appendChild(row);
        };

        function resetLiveryForm() {
            document.getElementById('liveryImg').value = '';
            document.getElementById('liveryAircraft').value = '';
            document.getElementById('liveryTitle').value = '';
            document.getElementById('liverySourcesContainer').innerHTML = '';
            document.getElementById('liveryOutdated').checked = false;
            const errDiv = document.getElementById('liveryFormError');
            if (errDiv) errDiv.style.display = 'none';
            window.addLiverySourceRow();
        }

        window.openAddLiveryModal = function() {
            if (!window.canManageLiveries()) {
                alert('Только администратор может добавлять ливреи!');
                return;
            }
            window.editingLiveryId = null;
            resetLiveryForm();
            document.getElementById('liveryModalHeader').textContent = 'Добавить ливрею';
            document.getElementById('liverySubmitBtn').textContent = 'Опубликовать ливрею';
            document.getElementById('addLiveryModal').classList.add('open');
        };

        window.openEditLiveryModal = function(id) {
            if (!window.canManageLiveries()) {
                alert('Только администратор может редактировать ливреи!');
                return;
            }
            const liv = window.allLiveries.find(l => l.id === id);
            if (!liv) return;

            window.editingLiveryId = id;
            document.getElementById('liveryImg').value = liv.img || '';
            document.getElementById('liveryAircraft').value = liv.aircraft || '';
            document.getElementById('liveryTitle').value = liv.title || '';

            const container = document.getElementById('liverySourcesContainer');
            container.innerHTML = '';
            const sources = Array.isArray(liv.sources) && liv.sources.length > 0 ? liv.sources : [{ text: '', link: '' }];
            sources.forEach(src => window.addLiverySourceRow(src.text, src.link));

            document.getElementById('liveryOutdated').checked = !!liv.outdated;

            const errDiv = document.getElementById('liveryFormError');
            if (errDiv) errDiv.style.display = 'none';

            document.getElementById('liveryModalHeader').textContent = 'Изменить ливрею';
            document.getElementById('liverySubmitBtn').textContent = 'Сохранить изменения';
            document.getElementById('addLiveryModal').classList.add('open');
        };

        window.closeLiveryModal = function() {
            document.getElementById('addLiveryModal').classList.remove('open');
            window.editingLiveryId = null;
        };

        window.submitLivery = async function() {
            if (!window.canManageLiveries()) {
                alert('Только администратор может публиковать ливреи!');
                return;
            }

            const img = document.getElementById('liveryImg').value.trim();
            const aircraft = document.getElementById('liveryAircraft').value.trim();
            const title = document.getElementById('liveryTitle').value.trim();
            const errDiv = document.getElementById('liveryFormError');

            if (!img || !aircraft || !title) {
                if (errDiv) {
                    errDiv.textContent = 'Заполните фото, самолет и название ливреи!';
                    errDiv.style.display = 'block';
                }
                return;
            }

            const sources = [];
            document.querySelectorAll('#liverySourcesContainer .livery-source-row').forEach(row => {
                const text = row.querySelector('.livery-source-text').value.trim();
                const link = row.querySelector('.livery-source-link').value.trim();
                if (text && link) sources.push({ text, link });
            });

            const outdated = document.getElementById('liveryOutdated').checked;

            const liveryData = { img, aircraft, title, sources, outdated, updatedAt: new Date().toISOString() };

            try {
                if (window.editingLiveryId) {
                    await setDoc(doc(db, 'liveries', window.editingLiveryId), liveryData, { merge: true });
                    await window.logAudit('Изменение ливреи', `${title} (${aircraft})`);
                } else {
                    liveryData.addedAt = new Date().toISOString();
                    await addDoc(collection(db, 'liveries'), liveryData);
                    await window.logAudit('Добавление ливреи', `${title} (${aircraft})`);
                }
                window.closeLiveryModal();
            } catch (error) {
                console.error('Ошибка сохранения ливреи:', error);
                if (errDiv) {
                    errDiv.textContent = 'Произошла ошибка при сохранении. Попробуйте снова.';
                    errDiv.style.display = 'block';
                }
            }
        };

        window.deleteLivery = async function(id) {
            if (!window.canManageLiveries()) {
                alert('Только администратор может удалять ливреи!');
                return;
            }
            const liv = window.allLiveries.find(l => l.id === id);
            if (!liv) return;

            if (confirm(`Удалить ливрею "${liv.title}" (${liv.aircraft})?`)) {
                try {
                    await deleteDoc(doc(db, 'liveries', id));
                    await window.logAudit('Удаление ливреи', `${liv.title} (${liv.aircraft})`);
                } catch (error) {
                    console.error('Ошибка удаления ливреи:', error);
                    alert('Произошла ошибка при удалении.');
                }
            }
        };

        // ================= УПРАВЛЕНИЕ УЧАСТНИКАМИ (ДАШБОРД) =================

        window.openMemberManagement = function() {
            document.getElementById('memberManagementModal').classList.add('open');
            window.renderMemberDashboard('all'); 
        };

        window.renderMemberDashboard = function(timeRange) {
            window.currentDashboardTimeRange = timeRange;
            document.querySelectorAll('#memberTimeFilters .filter-btn').forEach(btn => btn.classList.remove('active'));
            const activeBtn = Array.from(document.querySelectorAll('#memberTimeFilters .filter-btn'))
                                .find(b => b.getAttribute('onclick').includes(timeRange));
            if(activeBtn) activeBtn.classList.add('active');

            
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const msWeek = 7 * 24 * 60 * 60 * 1000;

            const flights = window.recentFlightsData || [];
            
            let cToday = 0, cWeek = 0, cAll = flights.length;
            flights.forEach(f => {
                const fTime = new Date(f.timestamp).getTime();
                if (fTime >= startOfToday) cToday++;
                if (now.getTime() - fTime <= msWeek) cWeek++;
            });

            document.getElementById('statToday').textContent = cToday;
            document.getElementById('statWeek').textContent = cWeek;
            document.getElementById('statAll').textContent = cAll;

            
            let filteredFlights = [];
            if (timeRange === 'today') filteredFlights = flights.filter(f => new Date(f.timestamp).getTime() >= startOfToday);
            else if (timeRange === 'week') filteredFlights = flights.filter(f => now.getTime() - new Date(f.timestamp).getTime() <= msWeek);
            else filteredFlights = flights;

            
            window.dashboardFilteredFlights = filteredFlights;
            window.currentDashboardRecentPage = 1;
            window.renderDashboardRecentFlights();

            
            const pilotCounts = {};
            filteredFlights.forEach(f => {
                if(!f.cid) return;
                pilotCounts[f.cid.toString()] = (pilotCounts[f.cid.toString()] || 0) + 1;
            });

            const topPilotsHtml = Object.entries(pilotCounts)
                .map(([cid, count]) => {
                    const pilot = window.MY_PILOTS.find(p => p.cid.toString() === cid) || { name: 'Неизвестный', cid: cid };
                    return { cid, name: pilot.name, count };
                })
                .sort((a,b) => b.count - a.count)
                .slice(0, 20) 
                .map((p, i) => `
                    <div class="top-active-item" style="padding: 10px; background: rgba(255,255,255,0.03); margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.03);">
                        <div class="top-active-rank" style="width:24px;height:24px;">${i+1}</div>
                        <div class="top-active-info" style="flex-direction:row; justify-content:space-between; align-items:center;">
                            <span class="top-active-name" style="font-size:13px;">${p.name} <span style="color:#666; font-size:10px;">(${p.cid})</span></span>
                            <div class="top-active-count" style="font-size:12px;">${p.count}</div>
                        </div>
                    </div>
                `).join('') || '<div style="text-align:center; color:#666; font-size: 12px; padding: 20px;">Нет данных</div>';
            
            document.getElementById('dashboardTopPilots').innerHTML = topPilotsHtml;

            
            const activePilots = [];
            const inactivePilots = [];
            
            window.MY_PILOTS.forEach(p => {
                const count = pilotCounts[p.cid.toString()] || 0;
                if(count > 0) activePilots.push({...p, count});
                else inactivePilots.push(p);
            });
            
            activePilots.sort((a,b) => b.count - a.count);

            function generateRosterRow(p, isInactive) {
                const discord = window.discordMap ? (window.discordMap[p.cid.toString()] || '---') : '---';
                const isBase = BASE_PILOTS.some(bp => bp.cid.toString() === p.cid.toString());
                
                let delBtn = !isBase ? `<button onclick="if(confirm('Удалить ${p.name}?')){ window.deletePilot('${p.cid}'); setTimeout(()=>window.renderMemberDashboard('${timeRange}'), 500); }" style="background:#e74c3c;color:white;border:none;padding:4px 8px;border-radius:4px;font-size:10px;cursor:pointer;">🗑️</button>` : '';

                let adminBtn = '';
                if (window.isFounder()) {
                    const role = window.adminsMap ? window.adminsMap[p.cid.toString()] : null;
                    if(role !== 'founder') {
                        if(role) adminBtn = `<button onclick="window.removeAdminPilot('${p.cid}'); setTimeout(()=>window.renderMemberDashboard('${timeRange}'), 500);" style="background:rgba(231,76,60,0.15);color:#e74c3c;border:1px solid rgba(231,76,60,0.3);padding:3px 6px;border-radius:4px;font-size:10px;cursor:pointer;">- Админ</button>`;
                        else adminBtn = `<button onclick="window.openAddAdminModalFor('${p.cid}', '${p.name.replace(/'/g, "\\'")}');" style="background:rgba(46,204,113,0.15);color:#2ecc71;border:1px solid rgba(46,204,113,0.3);padding:3px 6px;border-radius:4px;font-size:10px;cursor:pointer;">+ Админ</button>`;
                    }
                }
                
                const countTd = !isInactive ? `<td style="color:#2ecc71;font-weight:bold;text-align:center;">${p.count}</td>` : '';

                return `
                    <tr>
                        <td><strong>${p.name}</strong> <span style="color:#666;font-size:10px;display:block;">${p.cid}</span></td>
                        <td><span style="font-family:monospace;color:#aaa;font-size:11px;">${discord}</span></td>
                        ${countTd}
                        <td style="vertical-align:middle;"><div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">${delBtn}${adminBtn}</div></td>
                    </tr>
                `;
            }

            document.getElementById('dashboardRosterBody').innerHTML = activePilots.map(p => generateRosterRow(p, false))
                .join('') || `<tr><td colspan="4" style="text-align:center; padding: 20px; color:#666;">Нет активных пилотов</td></tr>`;

            document.getElementById('dashboardInactiveBody').innerHTML = inactivePilots.map(p => generateRosterRow(p, true))
                .join('') || `<tr><td colspan="3" style="text-align:center; padding: 20px; color:#666;">Все пилоты летали!</td></tr>`;
        };

        // ================= ОСТАЛЬНОЙ КОД (VATSIM, РОСТЕР И ИСТОРИЯ) =================
        async function loadFlightsFromFirebase() {
            try {
                const docRef = doc(db, 'vatsim_history', 'roster');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    window.firebaseFlightsCache = docSnap.data() || {};
                }
                // Последние полёты больше не читаются здесь — за это отвечает
                // listenToRecentFlights() (живой слушатель подколлекции recent_flights).
            } catch (error) {
                console.error("Ошибка чтения из Firebase:", error);
            }
        }

        // Живой слушатель подколлекции recent_flights — сайт только читает,
        // запись выполняет исключительно бот (tracker.js). Это убирает гонку записи
        // между ботом и всеми открытыми вкладками сайта, из-за которой полёты пропадали.
        function listenToRecentFlights() {
            const q = query(collection(db, 'recent_flights'), orderBy('timestamp', 'desc'), limit(200));
            onSnapshot(q, (snapshot) => {
                window.recentFlightsData = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
                renderRecentFlights();
                renderTopActive();
                // Обновляем ростер, чтобы у админа сразу пересчиталась дата
                // последнего вылета за клиренс (виджет виден только админам).
                if (window.isAdmin && window.isAdmin()) {
                    if (window.lastVatsimData) renderRoster(window.lastVatsimData);
                    else renderRoster({ pilots: [], controllers: [] });
                }
            });
        }

        // Возвращает { text, color } с датой последнего вылета конкретного
        // пилота с позывным CLR (данные берём из recent_flights, которые и так
        // логируют только полёты за клиренс) и цветом по давности:
        // <=15 дней — зелёный, <=30 — жёлтый, <=90 — оранжевый, 90+ — красный.
        function getLastClearanceFlightInfo(cid) {
            const flights = (window.recentFlightsData || []).filter(f => f.cid && f.cid.toString() === cid.toString());
            const count = flights.length;
            if (flights.length === 0) {
                return {
                    text: currentLang === 'en' ? 'No CLR flights yet' : 'Ещё не летал за клиренс',
                    color: '#777777',
                    count
                };
            }
            let latest = flights[0];
            flights.forEach(f => {
                if (new Date(f.timestamp) > new Date(latest.timestamp)) latest = f;
            });

            const lastDate = new Date(latest.timestamp);
            const diffDays = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

            let color = '#e74c3c'; // 90+ дней — красный
            if (diffDays <= 15) color = '#2ecc71';       // зелёный
            else if (diffDays <= 30) color = '#f1c40f';  // жёлтый
            else if (diffDays <= 90) color = '#e67e22';  // оранжевый

            const dateStr = lastDate.toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const daysLabel = currentLang === 'en'
                ? `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
                : `${diffDays} дн. назад`;

            return { text: `${dateStr} (${daysLabel})`, color, count };
        }

        // Считает количество вылетов за клиренс на каждого пилота компании
        // (по recent_flights) и рисует топ-5 самых активных в боковой панели.
        function renderTopActive() {
            const listEl = document.getElementById('topActiveList');
            if (!listEl) return;

            const flights = window.recentFlightsData || [];
            const countsByCid = {};
            flights.forEach(f => {
                if (!f.cid) return;
                const key = f.cid.toString();
                countsByCid[key] = (countsByCid[key] || 0) + 1;
            });

            const ranked = (window.MY_PILOTS || [])
                .map(p => ({
                    cid: p.cid,
                    name: p.name,
                    count: countsByCid[p.cid.toString()] || 0
                }))
                .filter(p => p.count > 0)
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            if (ranked.length === 0) {
                listEl.innerHTML = `<div class="top-active-empty">${currentLang === 'en' ? 'No flight data yet' : 'Пока нет данных о полетах'}</div>`;
                return;
            }

            listEl.innerHTML = ranked.map((p, i) => `
                <div class="top-active-item">
                    <div class="top-active-rank">${i + 1}</div>
                    <div class="top-active-info">
                        <span class="top-active-name">${p.name}</span>
                        <span class="top-active-cid">CID ${p.cid}</span>
                    </div>
                    <div class="top-active-count">${p.count}</div>
                </div>
            `).join('');
        }

        async function fetchVatsimData() {
            try {
                await loadFlightsFromFirebase();
                const response = await fetch('https://data.vatsim.net/v3/vatsim-data.json');
                if (!response.ok) throw new Error('Network error');
                const data = await response.json();
                window.lastVatsimData = data;

                let updatedDataToSave = { ...window.firebaseFlightsCache };
                let needUpdateFirebase = false;

                window.MY_PILOTS.forEach(localPilot => {
                    const onlinePilot = (data.pilots || []).find(p => p.cid.toString() === localPilot.cid.toString());
                    const onlineController = (data.controllers || []).find(c => c.cid.toString() === localPilot.cid.toString());

                    if (onlinePilot) {
                        const callsign = onlinePilot.callsign || '---';
                        let aircraft = '---';
                        let route = '---';
                        if (onlinePilot.flight_plan) {
                            aircraft = cleanAircraftType(onlinePilot.flight_plan.aircraft);
                            const dep = onlinePilot.flight_plan.departure || '???';
                            const arr = onlinePilot.flight_plan.arrival || '???';
                            route = `${dep} ➔ ${arr}`;
                        }
                        if (!window.firebaseFlightsCache[localPilot.cid] || window.firebaseFlightsCache[localPilot.cid].callsign !== callsign) {
                            updatedDataToSave[localPilot.cid] = { type: 'pilot', callsign, aircraft, route };
                            needUpdateFirebase = true;
                        }

                        // Запись в recent_flights теперь делает только бот (tracker.js) —
                        // сайт больше не пишет полёты сам, только читает через listenToRecentFlights().

                    } else if (onlineController) {
                        const callsign = onlineController.callsign || '---';
                        if (!window.firebaseFlightsCache[localPilot.cid] || window.firebaseFlightsCache[localPilot.cid].callsign !== callsign || window.firebaseFlightsCache[localPilot.cid].type !== 'controller') {
                            updatedDataToSave[localPilot.cid] = { type: 'controller', callsign, aircraft: 'ATC', route: '---' };
                            needUpdateFirebase = true;
                        }
                    }
                });

                if (needUpdateFirebase) {
                    window.firebaseFlightsCache = updatedDataToSave;
                    const docRef = doc(db, 'vatsim_history', 'roster');
                    await setDoc(docRef, updatedDataToSave, { merge: true });
                }

                renderRoster(window.lastVatsimData);
                window.renderProfileDropdownData();

            } catch (error) {
                console.error('Ошибка получения данных VATSIM:', error);
                renderRoster({ pilots: [], controllers: [] });
            }
        }

        function renderRoster(vatsimData) {
            if (!rosterTbody) return;
            rosterTbody.innerHTML = '';
            const pilotsOnline = vatsimData.pilots || [];
            const controllersOnline = vatsimData.controllers || [];

            const totalOnline = window.MY_PILOTS.filter(localPilot => 
                pilotsOnline.some(p => p.cid.toString() === localPilot.cid.toString()) || 
                controllersOnline.some(c => c.cid.toString() === localPilot.cid.toString())
            ).length;

            const counterTextEl = document.querySelector('#globalOnlineCounter .counter-text');
            if (counterTextEl) {
                counterTextEl.setAttribute('data-ru', `${totalOnline} в сети`);
                counterTextEl.setAttribute('data-en', `${totalOnline} online`);
                counterTextEl.textContent = currentLang === 'en' ? `${totalOnline} online` : `${totalOnline} в сети`;
            }

            const sortedPilots = [...window.MY_PILOTS].sort((a, b) => {
                const aIsController = controllersOnline.some(c => c.cid.toString() === a.cid.toString());
                const aIsPilot = pilotsOnline.some(p => p.cid.toString() === a.cid.toString());
                const bIsController = controllersOnline.some(c => c.cid.toString() === b.cid.toString());
                const bIsPilot = pilotsOnline.some(p => p.cid.toString() === b.cid.toString());

                const scoreA = aIsController ? 1 : (aIsPilot ? 2 : 3);
                const scoreB = bIsController ? 1 : (bIsPilot ? 2 : 3);

                return scoreA - scoreB;
            });

            const isAdmin = window.isAdmin();
            
            const totalPilots = sortedPilots.length;
            const visiblePilots = sortedPilots.slice(0, window.rosterLimit);

            visiblePilots.forEach(localPilot => {
                const onlinePilot = pilotsOnline.find(p => p.cid.toString() === localPilot.cid.toString());
                const onlineController = controllersOnline.find(c => c.cid.toString() === localPilot.cid.toString());

                let callsign = '---';
                let aircraft = '---';
                let route = '---';
                let statusBadge = '';
                let isOnline = false;

                const cacheData = window.firebaseFlightsCache[localPilot.cid] || null;

                if (onlinePilot) {
                    isOnline = true;
                    callsign = onlinePilot.callsign || '---';
                    if (onlinePilot.flight_plan) {
                        aircraft = cleanAircraftType(onlinePilot.flight_plan.aircraft);
                        const dep = onlinePilot.flight_plan.departure || '???';
                        const arr = onlinePilot.flight_plan.arrival || '???';
                        route = `${dep} ➔ ${arr}`;
                    }
                    statusBadge = `<span class="status-badge status-online">PILOT</span>`;
                } else if (onlineController) {
                    isOnline = true;
                    callsign = onlineController.callsign || '---';
                    aircraft = 'ATC';
                    route = '---';
                    statusBadge = `<span class="status-badge status-online" style="background-color: rgba(52, 152, 219, 0.15); color: #3498db; border-color: rgba(52, 152, 219, 0.3);">ATC</span>`;
                } else {
                    statusBadge = `<span class="status-badge status-offline">OFFLINE</span>`;
                }

                let roleBadge = '';
                const pilotRole = window.adminsMap ? window.adminsMap[localPilot.cid.toString()] : null;
                if (pilotRole === 'founder') {
                    roleBadge = `<span class="role-badge role-badge-founder">${currentLang === 'en' ? 'Founder' : 'Основатель'}</span>`;
                } else if (pilotRole === 'admin') {
                    roleBadge = `<span class="role-badge role-badge-admin">${currentLang === 'en' ? 'Admin' : 'Админ'}</span>`;
                } else if (pilotRole === 'liverymaker') {
                    roleBadge = `<span class="role-badge role-badge-liverymaker">${currentLang === 'en' ? 'Livery Maker' : 'Ливери-мейкер'}</span>`;
                }

                let detailsLabel = currentLang === 'en' ? 'Callsign' : 'Позывной';
                let detailCallsign = '---';
                let detailAircraft = '---';
                let detailRoute = '---';

                if (isOnline) {
                    detailsLabel = currentLang === 'en' ? 'Current Flight' : 'текущий полет';
                    detailCallsign = callsign;
                    detailAircraft = aircraft;
                    detailRoute = route;
                } else if (cacheData) {
                    detailsLabel = currentLang === 'en' ? 'Last Flight' : 'последний полет';
                    detailCallsign = cacheData.callsign || '---';
                    detailAircraft = cleanAircraftType(cacheData.aircraft);
                    detailRoute = cacheData.route || '---';
                }

                let clrLastSeenHtml = '';
                if (isAdmin) {
                    const clrInfo = getLastClearanceFlightInfo(localPilot.cid);
                    const clrCountLabel = currentLang === 'en'
                        ? `${clrInfo.count} flight${clrInfo.count === 1 ? '' : 's'}`
                        : `${clrInfo.count} ${pluralizeFlights(clrInfo.count)}`;
                    clrLastSeenHtml = `<span class="clr-lastseen-inline" style="color: ${clrInfo.color};" title="${currentLang === 'en' ? 'Last CLR flight' : 'Последний вылет за клиренс'}">${clrInfo.text}</span> <span class="clr-count-inline" title="${currentLang === 'en' ? 'Total CLR flights' : 'Всего вылетов за клиренс'}">(${clrCountLabel})</span>`;
                }

                const tr = document.createElement('tr');
                tr.className = 'pilot-row-clickable';
                if (window.openPilotCid === localPilot.cid) tr.classList.add('active');
                if (isAdmin) tr.style.cursor = 'context-menu';

                tr.innerHTML = `
                    <td>
                        <button class="btn-its-me" onclick="event.stopPropagation(); window.quickLogin('${localPilot.cid}')">это я!</button>
                        <button class="btn-its-me btn-dm" title="Написать в ЛС" onclick="event.stopPropagation(); window.startDM('${localPilot.cid}', '${localPilot.name.replace(/'/g, "\\'")}')">✉️ ЛС</button>
                        <strong>${localPilot.name}</strong> 
                        <span style="font-size:11px; color:#666;">(${localPilot.cid})</span>
                        ${clrLastSeenHtml}
                    </td>
                    <td><span style="font-family:monospace; font-weight:600; color:#fff;">${callsign}</span></td>
                    <td>${aircraft}</td>
                    <td>${route}</td>
                    <td><div class="status-cell">${statusBadge}${roleBadge}</div></td>
                `;

                const detailsTr = document.createElement('tr');
                detailsTr.className = 'pilot-details-row';
                detailsTr.id = `details-${localPilot.cid}`;
                
                if (window.openPilotCid === localPilot.cid) {
                    detailsTr.classList.add('open');
                }

                let discordDetailHtml = '';
                let passwordDetailHtml = '';
                if (isAdmin) {
                    const discordValue = window.discordMap ? (window.discordMap[localPilot.cid.toString()] || '') : '';
                    const discordInner = discordValue
                        ? `<span style="display:flex; align-items:center; gap:6px;">
                                <span style="font-family:monospace; color:#fff;">${escapeHtml(discordValue)}</span>
                                <button class="livery-admin-btn edit" title="Изменить" onclick="event.stopPropagation(); window.editPilotDiscord('${localPilot.cid}')">✏️</button>
                                <button class="livery-admin-btn del" title="Удалить" onclick="event.stopPropagation(); window.deletePilotDiscord('${localPilot.cid}')">🗑️</button>
                           </span>`
                        : `<button class="livery-admin-btn edit" title="Добавить Discord" onclick="event.stopPropagation(); window.editPilotDiscord('${localPilot.cid}')" style="width:auto; padding:2px 10px;">+ ${currentLang === 'en' ? 'Add' : 'Добавить'}</button>`;

                    discordDetailHtml = `
                        <div class="pilot-detail-item">
                            <span>DISCORD</span>
                            <span id="discordValue-${localPilot.cid}">${discordInner}</span>
                        </div>
                    `;

                    // Пароль пилота: изначально скрыт (замаскирован), запрашивается из
                    // Firebase только по клику на глазик (а не рассылается всем сразу),
                    // и появляется кнопка копирования, когда он раскрыт.
                    passwordDetailHtml = `
                        <div class="pilot-detail-item">
                            <span>ПАРОЛЬ</span>
                            <span style="display:flex; align-items:center; gap:6px;">
                                <span id="pwdValue-${localPilot.cid}" style="font-family:monospace; color:#fff; letter-spacing:2px; min-width:70px; display:inline-block;">••••••••</span>
                                <button class="livery-admin-btn edit" id="pwdEyeBtn-${localPilot.cid}" title="Показать пароль" onclick="event.stopPropagation(); window.togglePilotPasswordVisibility('${localPilot.cid}')">👁️</button>
                                <button class="livery-admin-btn edit" id="pwdCopyBtn-${localPilot.cid}" title="Скопировать" onclick="event.stopPropagation(); window.copyPilotPassword('${localPilot.cid}')" style="display:none;">📋</button>
                            </span>
                        </div>
                    `;
                }

                detailsTr.innerHTML = `
                    <td colspan="5">
                        <div class="pilot-details-wrapper">
                            <div class="pilot-details-inner">
                                <div class="pilot-detail-item">
                                    <span>${detailsLabel}</span>
                                    <strong style="font-family:monospace; font-size:16px; color:#fff;">${detailCallsign}</strong>
                                </div>
                                <div class="pilot-detail-item">
                                    <span>${currentLang === 'en' ? 'Aircraft' : 'Тип ВС'}</span>
                                    <span>${detailAircraft}</span>
                                </div>
                                <div class="pilot-detail-item">
                                    <span>${currentLang === 'en' ? 'Route' : 'Маршрут'}</span>
                                    <span>${detailRoute}</span>
                                </div>
                                ${discordDetailHtml}
                                ${passwordDetailHtml}
                                <button class="pilot-dm-link" onclick="event.stopPropagation(); window.startDM('${localPilot.cid}', '${localPilot.name.replace(/'/g, "\\'")}')">
                                    ✉️ ${currentLang === 'en' ? 'Message' : 'Написать в ЛС'}
                                </button>
                                <a href="https://stats.vatsim.net/stats/${localPilot.cid}" target="_blank" class="pilot-stats-link">
                                    ${currentLang === 'en' ? 'VATSIM Stats' : 'Статистика VATSIM'}
                                </a>
                            </div>
                        </div>
                    </td>
                `;

                tr.addEventListener('click', () => {
                    const isCurrentlyOpen = detailsTr.classList.contains('open');
                    document.querySelectorAll('.pilot-details-row').forEach(r => {
                        if (r !== detailsTr) r.classList.remove('open');
                    });
                    document.querySelectorAll('.pilot-row-clickable').forEach(r => {
                        if (r !== tr) r.classList.remove('active');
                    });
                    if (!isCurrentlyOpen) {
                        detailsTr.classList.add('open');
                        tr.classList.add('active');
                        window.openPilotCid = localPilot.cid;
                    } else {
                        detailsTr.classList.remove('open');
                        tr.classList.remove('active');
                        window.openPilotCid = null;
                    }
                });

                tr.addEventListener('contextmenu', (e) => {
                    if (!window.isAdmin()) return;
                    e.preventDefault();
                    e.stopPropagation();
                    window.openPilotContextMenu(e, localPilot.cid, localPilot.name);
                });

                rosterTbody.appendChild(tr);
                rosterTbody.appendChild(detailsTr);
            });

            renderTopActive();

            const fadeOverlay = document.getElementById('rosterFadeOverlay');
            const moreContainer = document.getElementById('rosterMoreContainer');
            const moreBtn = document.getElementById('showMorePilotsBtn');

            if (totalPilots > window.rosterLimit) {
                if (fadeOverlay) fadeOverlay.classList.add('visible');
                if (moreContainer) moreContainer.style.display = 'block';
                if (moreBtn) {
                    const remaining = totalPilots - window.rosterLimit;
                    moreBtn.textContent = currentLang === 'en' 
                        ? `Show More (${remaining})` 
                        : `Показать больше (${remaining})`;
                }
            } else {
                if (fadeOverlay) fadeOverlay.classList.remove('visible');
                if (moreContainer) moreContainer.style.display = 'none';
            }
        }

        window.openModal = function() { document.getElementById('privacyModal').classList.add('open'); };
        window.closeModal = function() { document.getElementById('privacyModal').classList.remove('open'); };

        window.isAdmin = function() { return window.currentAdminRole === 'founder' || window.currentAdminRole === 'admin'; };
        window.isFounder = function() { return window.currentAdminRole === 'founder'; };
        window.isLiveryMaker = function() { return window.currentAdminRole === 'liverymaker'; };
        // Полный админ и Основатель могут всё; Ливери-мейкер — обычный участник,
        // которому разрешено только управление разделом "Ливреи".
        window.canManageLiveries = function() { return window.isAdmin() || window.isLiveryMaker(); };
        function roleLabelRu(role) {
            if (role === 'founder') return 'Основатель';
            if (role === 'admin') return 'Администратор';
            if (role === 'liverymaker') return 'Ливери-мейкер';
            return 'Администратор';
        }

        async function tryAdminLogin(cid, password) {
            if (!cid || !password) {
                window.currentAdminRole = null;
                window.currentAdminCid = null;
                return false;
            }
            try {
                const ref = doc(db, 'admins', cid.toString());
                const snap = await getDoc(ref);
                if (snap.exists() && snap.data().password === password) {
                    const rawRole = snap.data().role;
                    window.currentAdminRole = (rawRole === 'founder' || rawRole === 'liverymaker') ? rawRole : 'admin';
                    window.currentAdminCid = cid.toString();
                    return true;
                }
            } catch (error) {
                console.error('Ошибка проверки администратора в Firebase:', error);
            }
            window.currentAdminRole = null;
            window.currentAdminCid = null;
            return false;
        }

        window.checkAdminPassword = async function() {
            const cidInput = document.getElementById('adminCidInput');
            const passInput = document.getElementById('adminPasswordInput');
            const errDiv = document.getElementById('adminAuthError');
            const cid = cidInput ? cidInput.value.trim() : '';
            const password = passInput ? passInput.value : '';

            const ok = await tryAdminLogin(cid, password);

            if (ok) {
                localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({ cid, password }));
                if (cidInput) cidInput.value = '';
                if (passInput) passInput.value = '';
                if (errDiv) errDiv.style.display = 'none';
                document.getElementById('adminAuthModal').classList.remove('open');
                document.getElementById('privacyModal').classList.remove('open');
                window.updateProfileWidget();
                if (window.lastVatsimData) renderRoster(window.lastVatsimData); 
                renderRecentFlights(); 
                window.renderEventsCarousel(); 
                window.renderLiveriesAdminList();
                window.renderLiveriesPublic();
                window.renderAuditLogs();
                const roleLabel = roleLabelRu(window.currentAdminRole);
                alert(`Доступ подтвержден! Ваша роль: ${roleLabel}.`);
            } else {
                if (errDiv) {
                    errDiv.textContent = 'Неверный VATSIM CID или пароль!';
                    errDiv.style.display = 'block';
                }
            }
        };

        window.logoutAdmin = function() {
            localStorage.removeItem(ADMIN_CACHE_KEY);
            window.currentAdminRole = null;
            window.currentAdminCid = null;
            stopListeningToAuditLogs();
            window.updateProfileWidget();
            if (window.lastVatsimData) renderRoster(window.lastVatsimData);
            renderRecentFlights();
            window.renderEventsCarousel(); 
            window.renderLiveriesAdminList();
            window.renderLiveriesPublic();
            window.renderAuditLogs();
            document.getElementById('adminPanelModal').classList.remove('open');
        };

        async function restoreAdminSession() {
            const raw = localStorage.getItem(ADMIN_CACHE_KEY);
            if (!raw) return;
            try {
                const { cid, password } = JSON.parse(raw);
                const ok = await tryAdminLogin(cid, password);
                if (!ok) {
                    localStorage.removeItem(ADMIN_CACHE_KEY);
                }
            } catch (error) {
                localStorage.removeItem(ADMIN_CACHE_KEY);
            }
        }

        window.openAdminPanel = function() {
            const infoDiv = document.getElementById('adminPanelRoleInfo');
            if (infoDiv) {
                const roleLabel = roleLabelRu(window.currentAdminRole);
                infoDiv.innerHTML = `Вы вошли как <strong>${roleLabel}</strong> (CID ${window.currentAdminCid}) &nbsp;·&nbsp; <span style="color:#e74c3c; cursor:pointer; text-decoration:underline;" onclick="window.logoutAdmin()">Выйти из админки</span>`;
            }
            // Журнал аудита читаем только сейчас, по факту открытия панели,
            // и только для Основателя/Админа (Ливери-мейкеру он не нужен и не показывается).
            if (window.isAdmin && window.isAdmin()) {
                listenToAuditLogs();
            }
            document.getElementById('adminPanelModal').classList.add('open');
        }

        window.closeAdminPanel = function() {
            document.getElementById('adminPanelModal').classList.remove('open');
            stopListeningToAuditLogs();
        }

        window.openAddAdminModalFor = function(cid, name) {
            if (!window.isFounder()) {
                alert('Только Основатель может добавлять администраторов!');
                return;
            }
            const cidInput = document.getElementById('newAdminCid');
            const passInput = document.getElementById('newAdminPassword');
            const roleSelect = document.getElementById('newAdminRole');
            const nameDiv = document.getElementById('addAdminTargetName');
            const errDiv = document.getElementById('addAdminError');
            if (cidInput) cidInput.value = cid;
            if (passInput) passInput.value = '';
            if (roleSelect) roleSelect.value = 'admin';
            if (nameDiv) nameDiv.textContent = name || '';
            if (errDiv) errDiv.style.display = 'none';
            document.getElementById('addAdminModal').classList.add('open');
        };

        window.removeAdminPilot = async function(cid) {
            if (!window.isFounder()) {
                alert('Только Основатель может убирать администраторов!');
                return;
            }
            if (confirm(`Убрать права администратора у CID ${cid}?`)) {
                try {
                    await deleteDoc(doc(db, 'admins', cid));
                    await window.logAudit('Снятие администратора', `CID: ${cid}`);
                } catch (error) {
                    console.error('Ошибка удаления администратора:', error);
                    alert('Произошла ошибка при удалении администратора.');
                }
            }
        };

        // ================= КОНТЕКСТНОЕ МЕНЮ ПИЛОТА (ПКМ) =================
        // Часть админ-действий в публичном ростере (сайт, доступный всем) скрыта
        // за правым кликом по строке пилота и видна/доступна только админам.
        // Обычные посетители не видят никаких кнопок управления вообще.
        // Discord (добавить/изменить/удалить) остаётся обычными кнопками рядом
        // с самим полем Discord в развернутой карточке пилота.
        // "+ Админ" / "− Админ" остаются доступны только Основателю (owner) —
        // пароль и удаление участника доступны любому админу.

        window.closePilotContextMenu = function() {
            const existing = document.getElementById('pilotContextMenu');
            if (existing) existing.remove();
        };

        window.openPilotContextMenu = function(event, cid, name) {
            event.preventDefault();
            window.closePilotContextMenu();

            if (!window.isAdmin()) return;

            const cidStr = cid.toString();
            const role = window.adminsMap ? window.adminsMap[cidStr] : null;
            const isTargetFounder = role === 'founder';
            const safeName = (name || '').replace(/'/g, "\\'");
            const isBasePilot = BASE_PILOTS.some(bp => bp.cid.toString() === cidStr);

            let itemsHtml = '';

            itemsHtml += `<div class="pilot-context-item" onclick="window.closePilotContextMenu(); window.generatePilotPassword('${cid}', '${safeName}');">🔑 Добавить пароль</div>`;

            if (window.isFounder() && !isTargetFounder) {
                itemsHtml += role
                    ? `<div class="pilot-context-item danger" onclick="window.closePilotContextMenu(); window.removeAdminPilot('${cid}'); setTimeout(()=>window.renderMemberDashboard(window.currentDashboardTimeRange), 400);">− Админ</div>`
                    : `<div class="pilot-context-item" onclick="window.closePilotContextMenu(); window.openAddAdminModalFor('${cid}', '${safeName}');">+ Админ</div>`;
            }

            // Блокировка мессенджера и поддержки — доступны только Основателю (owner)
            // и не применяются к самому Основателю. Каждый пункт меняется в
            // зависимости от текущего статуса: нет блокировки / ожидает (10 сек) / уже активна.
            if (window.isFounder() && !isTargetFounder) {
                const blockStatus = window.getMessengerBlockStatus(cid);
                if (blockStatus.active) {
                    itemsHtml += `<div class="pilot-context-item" onclick="window.closePilotContextMenu(); window.unblockPilotMessenger('${cid}');">✅ Разблокировать мессенджер</div>`;
                } else if (blockStatus.pending) {
                    const secsLeft = Math.max(1, Math.ceil(blockStatus.msLeft / 1000));
                    itemsHtml += `<div class="pilot-context-item danger" onclick="window.closePilotContextMenu(); window.unblockPilotMessenger('${cid}');">⏳ Блокировка через ${secsLeft} сек · отменить</div>`;
                } else {
                    itemsHtml += `<div class="pilot-context-item danger" onclick="window.closePilotContextMenu(); window.blockPilotMessenger('${cid}', '${safeName}');">🚫 Заблокировать мессенджер</div>`;
                }

                // Отдельная кнопка — блокировка чата поддержки («Связь с администрацией»),
                // работает независимо от блокировки мессенджера.
                const supportStatus = window.getSupportBlockStatus(cid);
                if (supportStatus.active) {
                    itemsHtml += `<div class="pilot-context-item" onclick="window.closePilotContextMenu(); window.unblockPilotSupport('${cid}');">✅ Разблокировать поддержку</div>`;
                } else if (supportStatus.pending) {
                    const secsLeftSupport = Math.max(1, Math.ceil(supportStatus.msLeft / 1000));
                    itemsHtml += `<div class="pilot-context-item danger" onclick="window.closePilotContextMenu(); window.unblockPilotSupport('${cid}');">⏳ Блокировка поддержки через ${secsLeftSupport} сек · отменить</div>`;
                } else {
                    itemsHtml += `<div class="pilot-context-item danger" onclick="window.closePilotContextMenu(); window.blockPilotSupport('${cid}', '${safeName}');">🚫 Заблокировать поддержку</div>`;
                }
            }

            if (!isBasePilot && !isTargetFounder) {
                itemsHtml += `<div class="pilot-context-item danger" onclick="window.closePilotContextMenu(); window.deletePilot('${cid}');">🗑️ Удалить участника</div>`;
            }

            if (!itemsHtml) return;

            const menu = document.createElement('div');
            menu.id = 'pilotContextMenu';
            menu.className = 'pilot-context-menu';
            menu.innerHTML = itemsHtml;
            document.body.appendChild(menu);

            const menuWidth = menu.offsetWidth || 160;
            const menuHeight = menu.offsetHeight || 80;
            // .pilot-context-menu использует position: fixed, значит координаты
            // должны браться относительно окна (clientX/clientY), а не всего
            // документа (pageX/pageY) — иначе при прокрутке страницы меню
            // появлялось ниже курсора на высоту прокрутки.
            let left = event.clientX;
            let top = event.clientY;
            if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
            if (top + menuHeight > window.innerHeight - 10) top = window.innerHeight - menuHeight - 10;
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';

            setTimeout(() => {
                document.addEventListener('click', window.closePilotContextMenu, { once: true });
                document.addEventListener('contextmenu', window.closePilotContextMenu, { once: true });
            }, 0);
        };

        window.generatePilotPassword = async function(cid, name) {
            if (!window.isAdmin()) {
                alert('Недостаточно прав для выдачи пароля!');
                return;
            }
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
            const randomPassword = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

            try {
                await setDoc(doc(db, 'pilot_auth', cid.toString()), {
                    password: randomPassword,
                    mustChange: true,
                    updatedAt: new Date().toISOString()
                });
                await window.logAudit('Выдача пароля', `CID ${cid} (${name || ''})`);
                alert(`Временный пароль для ${name || 'пилота'} (CID ${cid}):\n\n${randomPassword}\n\nПередайте его пилоту лично — при следующем входе система попросит его сменить на свой собственный.`);
            } catch (error) {
                console.error('Ошибка создания пароля:', error);
                alert('Не удалось создать пароль. Попробуйте снова.');
            }
        };

        window.createNewAdmin = async function() {
            if (!window.isFounder()) {
                alert('Только Основатель может добавлять администраторов!');
                return;
            }
            const cidInput = document.getElementById('newAdminCid');
            const passInput = document.getElementById('newAdminPassword');
            const roleSelect = document.getElementById('newAdminRole');
            const errDiv = document.getElementById('addAdminError');
            const cid = cidInput.value.trim();
            const password = passInput.value.trim();
            const role = (roleSelect && roleSelect.value === 'liverymaker') ? 'liverymaker' : 'admin';

            if (!cid || !password) {
                if (errDiv) { errDiv.textContent = 'Заполните VATSIM CID и пароль!'; errDiv.style.display = 'block'; }
                return;
            }
            if (password.length < 6) {
                if (errDiv) { errDiv.textContent = 'Пароль должен быть не короче 6 символов!'; errDiv.style.display = 'block'; }
                return;
            }

            try {
                await setDoc(doc(db, 'admins', cid), {
                    password: password,
                    role: role,
                    addedBy: window.currentAdminCid
                });
                
                await window.logAudit('Назначение администратора', `Новый ${roleLabelRu(role)} CID: ${cid}`);
                
                cidInput.value = '';
                passInput.value = '';
                if (errDiv) errDiv.style.display = 'none';
                document.getElementById('addAdminModal').classList.remove('open');
                alert(`${roleLabelRu(role)} с CID ${cid} добавлен и сохранен в Firebase!`);
            } catch (error) {
                console.error('Ошибка создания администратора:', error);
                if (errDiv) { errDiv.textContent = 'Ошибка сохранения в Firebase.'; errDiv.style.display = 'block'; }
            }
        };

        window.addAdminPilot = async function() {
            const cidInput = document.getElementById('newPilotCid');
            const nameInput = document.getElementById('newPilotName');
            const cid = cidInput.value.trim();
            const name = nameInput.value.trim();
            
            if(!cid || !name) {
                alert('Пожалуйста, заполните ID и имя пилота!');
                return;
            }
            
            if (window.MY_PILOTS.some(p => p.cid.toString() === cid.toString())) {
                alert('Пилот с таким CID уже внесен в список компании!');
                return;
            }
            
            try {
                await setDoc(doc(db, 'custom_pilots', cid), { cid, name });
                await window.logAudit('Добавление пилота', `Имя: ${name}, CID: ${cid}`);
                
                cidInput.value = '';
                nameInput.value = '';
                alert(`Пилот ${name} (${cid}) добавлен в базу!`);
            } catch (error) {
                console.error("Ошибка при добавлении пилота: ", error);
                alert("Ошибка сохранения пилота.");
            }
        };

        window.deletePilot = async function(cid) {
            if (confirm(`Вы уверены, что хотите удалить пилота с CID ${cid} из ростера?`)) {
                try {
                    await deleteDoc(doc(db, 'custom_pilots', cid));
                    await window.logAudit('Удаление пилота', `Удален CID: ${cid}`);
                } catch (error) {
                    console.error("Ошибка удаления:", error);
                    alert("Произошла ошибка при удалении.");
                }
            }
        }

        window.toggleProfileDropdown = function(e) {
            e.stopPropagation();
            const dropdown = document.getElementById('profileDropdown');
            if (dropdown) {
                dropdown.classList.toggle('active');
                if (dropdown.classList.contains('active')) {
                    window.renderProfileDropdownData();
                }
            }
        };

        window.quickLogin = async function(cid) {
            try {
                const ref = doc(db, 'pilot_auth', cid.toString());
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    // У пилота есть пароль — быстрый вход без пароля запрещён,
                    // открываем форму входа с уже подставленным CID.
                    window.updateProfileWidget();
                    setTimeout(() => {
                        const dropdown = document.getElementById('profileDropdown');
                        if (dropdown) dropdown.classList.add('active');
                        const cidInput = document.getElementById('profileCidInput');
                        if (cidInput) cidInput.value = cid;
                        const passInput = document.getElementById('profilePasswordInput');
                        if (passInput) passInput.focus();
                    }, 80);
                    return;
                }
            } catch (error) {
                console.error('Ошибка проверки пароля пилота:', error);
            }
            window.completePilotLogin(cid, null);
        };

        // Кнопка "Написать в ЛС" в ростере: если пилот ещё не вошёл в аккаунт —
        // открываем форму входа (профиль в шапке), иначе сразу переносим его
        // в личный кабинет с открытым диалогом с выбранным пилотом.
        window.startDM = function(targetCid, targetName) {
            const myCid = localStorage.getItem('vatsim_pilot_cid');
            if (!myCid) {
                sessionStorage.setItem('vc_pending_dm', JSON.stringify({ cid: targetCid.toString(), name: targetName || ('CID ' + targetCid) }));
                window.updateProfileWidget();
                setTimeout(() => {
                    const dropdown = document.getElementById('profileDropdown');
                    if (dropdown) dropdown.classList.add('active');
                    const cidInput = document.getElementById('profileCidInput');
                    if (cidInput) cidInput.focus();
                }, 80);
                alert(currentLang === 'en'
                    ? 'Sign in first, then you will be taken to the chat.'
                    : 'Сначала войдите в аккаунт — после входа откроется чат.');
                return;
            }
            if (myCid.toString() === targetCid.toString()) {
                alert(currentLang === 'en' ? "You can't message yourself." : 'Нельзя написать самому себе.');
                return;
            }
            window.location.href = 'cabinet.html?dm=' + encodeURIComponent(targetCid) + '&name=' + encodeURIComponent(targetName || ('CID ' + targetCid));
        };

        window.loginProfile = async function() {
            const cidInput = document.getElementById('profileCidInput');
            const passInput = document.getElementById('profilePasswordInput');
            const errDiv = document.getElementById('profileLoginError');
            const cid = cidInput ? cidInput.value.trim() : '';
            const password = passInput ? passInput.value : '';

            if (!cid) return;
            if (errDiv) errDiv.style.display = 'none';

            let verifiedPassword = null;

            try {
                const ref = doc(db, 'pilot_auth', cid.toString());
                const snap = await getDoc(ref);

                if (snap.exists()) {
                    const data = snap.data();
                    if (data.password !== password) {
                        if (errDiv) { errDiv.textContent = 'Неверный пароль!'; errDiv.style.display = 'block'; }
                        return;
                    }
                    verifiedPassword = password;
                    if (data.mustChange) {
                        window.pendingPasswordChangeCid = cid;
                        if (passInput) passInput.value = '';
                        document.getElementById('changePasswordModal').classList.add('open');
                        return;
                    }
                }
            } catch (error) {
                console.error('Ошибка проверки пароля пилота:', error);
                if (errDiv) { errDiv.textContent = 'Ошибка проверки пароля. Попробуйте снова.'; errDiv.style.display = 'block'; }
                return;
            }

            window.completePilotLogin(cid, verifiedPassword);
        };

        // cid — CID вошедшего пилота. password — пароль, которым он подтвердил вход
        // (null, если для этого CID пароль ещё не задан админом). Пароль сохраняется
        // локально вместе с CID, чтобы validatePilotSession() могла при каждой загрузке
        // страницы сверить его с актуальным паролем в Firebase и выкинуть из аккаунта
        // всех, чьи локальные сессии больше не соответствуют реальному паролю
        // (устаревшие сессии с эпохи входа без пароля, сброшенные/изменённые пароли и т.п.)
        window.completePilotLogin = function(cid, password) {
            localStorage.setItem('vatsim_pilot_cid', cid);
            localStorage.setItem('vc_pilot_pwd', password || '');

            // Если вход был инициирован кнопкой "Написать в ЛС" в ростере —
            // сразу переходим в личный кабинет к открытому диалогу.
            const pendingDmRaw = sessionStorage.getItem('vc_pending_dm');
            if (pendingDmRaw) {
                sessionStorage.removeItem('vc_pending_dm');
                try {
                    const pending = JSON.parse(pendingDmRaw);
                    if (pending && pending.cid && pending.cid.toString() !== cid.toString()) {
                        window.location.href = 'cabinet.html?dm=' + encodeURIComponent(pending.cid) + '&name=' + encodeURIComponent(pending.name || '');
                        return;
                    }
                } catch (e) { /* игнорируем некорректные данные */ }
            }

            window.updateProfileWidget();
            setTimeout(() => {
                const dropdown = document.getElementById('profileDropdown');
                if (dropdown) {
                    dropdown.classList.add('active');
                    window.renderProfileDropdownData();
                }
            }, 80);
        };

        window.closeChangePasswordModal = function() {
            document.getElementById('changePasswordModal').classList.remove('open');
            window.pendingPasswordChangeCid = null;
            const p1 = document.getElementById('newPasswordInput1');
            const p2 = document.getElementById('newPasswordInput2');
            if (p1) p1.value = '';
            if (p2) p2.value = '';
            const errDiv = document.getElementById('changePasswordError');
            if (errDiv) errDiv.style.display = 'none';
        };

        window.submitPasswordChange = async function() {
            const cid = window.pendingPasswordChangeCid;
            const p1El = document.getElementById('newPasswordInput1');
            const p2El = document.getElementById('newPasswordInput2');
            const errDiv = document.getElementById('changePasswordError');
            const p1 = p1El ? p1El.value : '';
            const p2 = p2El ? p2El.value : '';

            if (!cid) return;

            if (!p1 || !p2) {
                if (errDiv) { errDiv.textContent = 'Заполните оба поля!'; errDiv.style.display = 'block'; }
                return;
            }
            if (p1.length < 6) {
                if (errDiv) { errDiv.textContent = 'Пароль должен быть не короче 6 символов!'; errDiv.style.display = 'block'; }
                return;
            }
            if (p1 !== p2) {
                if (errDiv) { errDiv.textContent = 'Пароли не совпадают!'; errDiv.style.display = 'block'; }
                return;
            }

            try {
                await setDoc(doc(db, 'pilot_auth', cid.toString()), {
                    password: p1,
                    mustChange: false,
                    updatedAt: new Date().toISOString()
                }, { merge: true });

                if (p1El) p1El.value = '';
                if (p2El) p2El.value = '';
                if (errDiv) errDiv.style.display = 'none';
                document.getElementById('changePasswordModal').classList.remove('open');

                window.pendingPasswordChangeCid = null;
                window.completePilotLogin(cid, p1);
            } catch (error) {
                console.error('Ошибка сохранения пароля:', error);
                if (errDiv) { errDiv.textContent = 'Ошибка сохранения в Firebase. Попробуйте снова.'; errDiv.style.display = 'block'; }
            }
        };

        window.logoutProfile = function() {
            localStorage.removeItem('vatsim_pilot_cid');
            localStorage.removeItem('vc_pilot_pwd');
            window.updateProfileWidget();
        };

        // Сверяет локально сохранённую сессию пилота с актуальным паролем в Firebase.
        // Раньше вход не требовал пароля, поэтому у части пользователей в localStorage
        // остался просто голый CID без пароля — если для этого CID теперь задан пароль,
        // такая сессия принудительно завершается и требует повторного входа.
        // То же самое происходит, если пароль пилота был изменён/сброшен админом,
        // а старая сессия в браузере ещё хранит предыдущий пароль (например, у чужого
        // человека, который когда-то вошёл в аккаунт с этого CID).
        async function validatePilotSession() {
            const savedCid = localStorage.getItem('vatsim_pilot_cid');
            if (!savedCid) return;
            try {
                const ref = doc(db, 'pilot_auth', savedCid.toString());
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    const data = snap.data();
                    const storedPwd = localStorage.getItem('vc_pilot_pwd') || '';
                    if (!storedPwd || storedPwd !== data.password) {
                        localStorage.removeItem('vatsim_pilot_cid');
                        localStorage.removeItem('vc_pilot_pwd');
                    }
                }
            } catch (error) {
                console.error('Ошибка проверки сессии пилота:', error);
            }
        }

        window.updateProfileWidget = function() {
            const widget = document.getElementById('profileWidget');
            if (!widget) return;
            const savedCid = localStorage.getItem('vatsim_pilot_cid');
            const isAdmin = window.isAdmin();
            
            const adminButtonHtml = isAdmin ? `<button class="btn" style="background: #e74c3c; color: white; border: none; width: 100%; padding: 8px; border-radius: 6px; font-weight: 600; font-size: 12px; margin-top: 10px; letter-spacing: 0.5px;" onclick="window.location.href='admin.html'">Админ-Панель</button>` : '';
            const cabinetLabel = currentLang === 'en' ? 'My Cabinet' : 'Личный кабинет';
            const cabinetButtonHtml = `<div class="btn-cabinet-wrap"><button class="btn" style="background: rgba(255,255,255,0.06); color: #fff; border: 1px solid rgba(255,255,255,0.1); width: 100%; padding: 8px; border-radius: 6px; font-weight: 600; font-size: 12px; margin-top: 10px; letter-spacing: 0.5px;" onclick="window.location.href='cabinet.html'">${cabinetLabel}</button><span class="unread-msg-dot" id="cabinetUnreadDot"></span></div>`;

            if (!savedCid) {
                watchUnreadSupportDot(null);
                const btnText = currentLang === 'en' ? 'Sign In' : 'Войти';
                const headingText = currentLang === 'en' ? 'Sign In' : 'Вход';
                const placeholderText = currentLang === 'en' ? 'Enter CID...' : 'Введите CID...';
                const passwordPlaceholder = currentLang === 'en' ? 'Password (if set)' : 'Пароль (если задан)';
                const forgotText = currentLang === 'en' ? 'Forgot CID?' : 'Забыли CID?';
                widget.innerHTML = `
                    <button class="profile-btn" onclick="window.toggleProfileDropdown(event)">
                        <span>${btnText}</span>
                    </button>
                    <div class="profile-dropdown" id="profileDropdown" onclick="event.stopPropagation()">
                        <div class="profile-login-form">
                            <div class="login-title">${headingText}</div>
                            <input type="text" id="profileCidInput" placeholder="${placeholderText}" maxlength="8">
                            <input type="password" id="profilePasswordInput" placeholder="${passwordPlaceholder}" onkeydown="if(event.key==='Enter') window.loginProfile();">
                            <div id="profileLoginError" style="display:none; color:#ff4d4d; font-size:11px; margin-top:2px;"></div>
                            <button onclick="window.loginProfile()">${btnText}</button>
                            <span class="forgot-cid-link" onclick="window.highlightItsMeButtons()">${forgotText}</span>
                        </div>
                        ${cabinetButtonHtml}
                        ${adminButtonHtml}
                    </div>
                `;
            } else {
                widget.innerHTML = `
                    <button class="profile-btn" onclick="window.toggleProfileDropdown(event)">
                        <span>${savedCid}</span>
                        <span class="unread-msg-dot" id="profileUnreadDot"></span>
                    </button>
                    <div class="profile-dropdown" id="profileDropdown" onclick="event.stopPropagation()">
                        <div id="profileDropdownContent">
                            <div style="font-size:12px; color:#aaa; text-align:center; padding:5px 0;">Загрузка...</div>
                        </div>
                        ${cabinetButtonHtml}
                        ${adminButtonHtml}
                        <button class="logout-btn" onclick="window.logoutProfile()">${currentLang === 'en' ? 'Log Out' : 'Выйти'}</button>
                    </div>
                `;
                window.renderProfileDropdownData();
                watchUnreadSupportDot(savedCid);
            }
        };

        window.renderProfileDropdownData = async function() {
            const savedCid = localStorage.getItem('vatsim_pilot_cid');
            const content = document.getElementById('profileDropdownContent');
            if (!savedCid || !content) return;

            let onlinePilot = null;
            let onlineController = null;

            if (window.lastVatsimData) {
                onlinePilot = (window.lastVatsimData.pilots || []).find(p => p.cid.toString() === savedCid.toString());
                onlineController = (window.lastVatsimData.controllers || []).find(c => c.cid.toString() === savedCid.toString());
            }

            if (onlinePilot) {
                const callsign = onlinePilot.callsign || '---';
                let dep = '???', arr = '???';
                if (onlinePilot.flight_plan) {
                    dep = onlinePilot.flight_plan.departure || '???';
                    arr = onlinePilot.flight_plan.arrival || '???';
                }

                let metarDep = 'LOADING...', metarArr = 'LOADING...';
                try {
                    const resDep = await fetch(`https://metar.vatsim.net/metar.php?id=${dep}`);
                    metarDep = resDep.ok ? await resDep.text() : 'NO METAR DATA';
                    const resArr = await fetch(`https://metar.vatsim.net/metar.php?id=${arr}`);
                    metarArr = resArr.ok ? await resArr.text() : 'NO METAR DATA';
                } catch(e) {
                    metarDep = 'ERROR METAR'; metarArr = 'ERROR METAR';
                }

                content.innerHTML = `
                    <div class="cid-res-header">
                        <span>${currentLang === 'en' ? 'VATSIM ONLINE' : 'В СЕТИ VATSIM'}</span>
                        <span class="status-badge status-online">PILOT</span>
                    </div>
                    <div class="cid-res-pilot">${onlinePilot.name || 'Pilot'} (${savedCid})</div>
                    <div class="cid-res-route">Callsign: <strong>${callsign}</strong> | Flight: <strong>${dep} ➔ ${arr}</strong></div>
                    <div class="cid-res-metar-title">METAR ${dep}:</div>
                    <div class="cid-res-metar-box">${metarDep}</div>
                    <div class="cid-res-metar-title">METAR ${arr}:</div>
                    <div class="cid-res-metar-box">${metarArr}</div>
                `;
            } else if (onlineController) {
                const callsign = onlineController.callsign || '---';
                content.innerHTML = `
                    <div class="cid-res-header">
                        <span>${currentLang === 'en' ? 'VATSIM ONLINE' : 'В СЕТИ VATSIM'}</span>
                        <span class="status-badge status-online" style="background-color: rgba(52, 152, 219, 0.15); color: #3498db; border-color: rgba(52, 152, 219, 0.3);">ATC</span>
                    </div>
                    <div class="cid-res-pilot">${onlineController.name || 'Controller'} (${savedCid})</div>
                    <div class="cid-res-route">${currentLang === 'en' ? 'Duty' : 'Позиция'}: <strong>${callsign}</strong></div>
                    <div class="cid-res-metar-box" style="text-align:center; color:#888; padding:15px 0;">
                        ${currentLang === 'en' ? 'Metar data is available for pilots only.' : 'МЕТАР данные доступны только для выполняющих полет пилотов.'}
                    </div>
                `;
            } else {
                const cacheData = window.firebaseFlightsCache[savedCid] || null;
                const companyPilot = window.MY_PILOTS.find(p => p.cid.toString() === savedCid.toString());

                if (cacheData || companyPilot) {
                    const pilotDisplayName = companyPilot ? companyPilot.name : 'Unknown Pilot';
                    
                    const callsign = cacheData ? (cacheData.callsign || '---') : '---';
                    const route = cacheData ? (cacheData.route || '---') : '---';
                    const aircraft = cacheData ? cleanAircraftType(cacheData.aircraft) : '---';
                    const labelType = (cacheData && cacheData.type === 'controller') ? 'ATC' : (currentLang === 'en' ? 'Last Flight' : 'Последний полет');

                    let dep = '???', arr = '???';
                    if (cacheData && cacheData.route && cacheData.route.includes('➔')) {
                        const parts = cacheData.route.split('➔');
                        if (parts.length === 2) {
                            dep = parts[0].trim();
                            arr = parts[1].trim();
                        }
                    }

                    let metarHtml = '';
                    if (dep !== '???' && arr !== '???') {
                        let metarDep = 'LOADING...', metarArr = 'LOADING...';
                        try {
                            const resDep = await fetch(`https://metar.vatsim.net/metar.php?id=${dep}`);
                            metarDep = resDep.ok ? await resDep.text() : 'NO METAR DATA';
                            const resArr = await fetch(`https://metar.vatsim.net/metar.php?id=${arr}`);
                            metarArr = resArr.ok ? await resArr.text() : 'NO METAR DATA';
                        } catch(e) {
                            metarDep = 'ERROR METAR'; metarArr = 'ERROR METAR';
                        }
                        metarHtml = `
                            <div class="cid-res-metar-title">METAR ${dep}:</div>
                            <div class="cid-res-metar-box">${metarDep}</div>
                            <div class="cid-res-metar-title">METAR ${arr}:</div>
                            <div class="cid-res-metar-box">${metarArr}</div>
                        `;
                    }

                    content.innerHTML = `
                        <div class="cid-res-header">
                            <span>${currentLang === 'en' ? 'VATSIM OFFLINE' : 'ВНЕ СЕТИ VATSIM'}</span>
                            <span class="status-badge status-offline">OFFLINE</span>
                        </div>
                        <div class="cid-res-pilot">${pilotDisplayName} (${savedCid})</div>
                        <div class="cid-res-route" style="margin-top: 8px; margin-bottom: 5px;">
                            <strong>${labelType}:</strong><br>
                            ${currentLang === 'en' ? 'Callsign' : 'Позывной'}: ${callsign}<br>
                            ${currentLang === 'en' ? 'Route' : 'Маршрут'}: ${route}<br>
                            ${currentLang === 'en' ? 'Aircraft' : 'Тип ВС'}: ${aircraft}
                        </div>
                        ${metarHtml}
                    `;
                } else {
                    content.innerHTML = `
                        <div style="font-size:12px; color:#ff4d4d; text-align:center; padding:10px 0;">
                            ${currentLang === 'en' ? 'CID not found online or in company database.' : 'CID не найден в сети и в базе компании.'}
                        </div>
                    `;
                }
            }
        };

        document.addEventListener('click', (e) => {
            const widget = document.getElementById('profileWidget');
            if (widget && !widget.contains(e.target)) {
                const dropdown = document.getElementById('profileDropdown');
                if (dropdown) dropdown.classList.remove('active');
            }
        });

        window.deleteRecentFlight = async function(docId) {
            if (confirm('Вы уверены, что хотите удалить этот полет из истории?')) {
                try {
                    // Удаляем конкретный документ из подколлекции recent_flights —
                    // на остальные записи (и на бота) это никак не влияет.
                    await deleteDoc(doc(db, 'recent_flights', docId));
                    await window.logAudit('Удаление истории', `Удален полет ID: ${docId}`);
                    // window.recentFlightsData обновится сам через onSnapshot в listenToRecentFlights()
                } catch (error) {
                    console.error("Ошибка при удалении полета: ", error);
                    alert("Произошла ошибка при удалении записи о полете.");
                }
            }
        };

        function renderRecentFlights() {
            const tbody = document.getElementById('recent-flights-tbody');
            if (!tbody) return;
            
            tbody.innerHTML = '';
            
            if (window.recentFlightsData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color:#666;">
                    ${currentLang === 'en' ? 'No recent flights found.' : 'История полетов пока пуста.'}
                </td></tr>`;
                document.getElementById('pageIndicator').textContent = 'Страница 1 / 1';
                document.getElementById('prevPageBtn').disabled = true;
                document.getElementById('nextPageBtn').disabled = true;
                return;
            }

            const totalPages = Math.ceil(window.recentFlightsData.length / FLIGHTS_PER_PAGE);
            
            if (window.currentRecentPage > totalPages) window.currentRecentPage = totalPages;
            if (window.currentRecentPage < 1) window.currentRecentPage = 1;

            const startIndex = (window.currentRecentPage - 1) * FLIGHTS_PER_PAGE;
            const endIndex = startIndex + FLIGHTS_PER_PAGE;
            const flightsToShow = window.recentFlightsData.slice(startIndex, endIndex);

            const isAdmin = window.isAdmin();

            flightsToShow.forEach(flight => {
                const dateObj = new Date(flight.timestamp);
                const dateStr = dateObj.toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'ru-RU', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit'
                });

                let deleteBtnHtml = '';
                if (isAdmin) {
                    deleteBtnHtml = `<button onclick="event.stopPropagation(); window.deleteRecentFlight('${flight.docId}')" style="background: #e74c3c; color: white; border: none; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px; cursor: pointer;">Удалить</button>`;
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="color:#aaa; font-size: 13px;">${dateStr}</td>
                    <td><strong>${flight.name}</strong> <span style="font-size:11px; color:#666;">(${flight.cid})</span> ${deleteBtnHtml}</td>
                    <td><span style="font-family:monospace; font-weight:600; color:#2ecc71;">${flight.callsign}</span></td>
                    <td>${flight.route}</td>
                    <td>${flight.aircraft}</td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById('pageIndicator').textContent = 
                currentLang === 'en' ? `Page ${window.currentRecentPage} / ${totalPages}` 
                                     : `Страница ${window.currentRecentPage} / ${totalPages}`;
            
            document.getElementById('prevPageBtn').disabled = window.currentRecentPage === 1;
            document.getElementById('nextPageBtn').disabled = window.currentRecentPage === totalPages;
        }

        window.changeRecentPage = function(direction) {
            window.currentRecentPage += direction;
            renderRecentFlights();
        };

        window.renderDashboardRecentFlights = function() {
            const recentBody = document.getElementById('dashboardRecentBody');
            if (!recentBody) return;

            const flights = window.dashboardFilteredFlights || [];

            if (flights.length === 0) {
                recentBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px; color: #666;">Нет данных за этот период</td></tr>`;
                document.getElementById('dashboardRecentPageIndicator').textContent = 'Страница 1 / 1';
                document.getElementById('dashboardRecentPrevBtn').disabled = true;
                document.getElementById('dashboardRecentNextBtn').disabled = true;
                return;
            }

            const totalPages = Math.ceil(flights.length / DASHBOARD_FLIGHTS_PER_PAGE);
            if (window.currentDashboardRecentPage > totalPages) window.currentDashboardRecentPage = totalPages;
            if (window.currentDashboardRecentPage < 1) window.currentDashboardRecentPage = 1;

            const startIndex = (window.currentDashboardRecentPage - 1) * DASHBOARD_FLIGHTS_PER_PAGE;
            const endIndex = startIndex + DASHBOARD_FLIGHTS_PER_PAGE;
            const pageFlights = flights.slice(startIndex, endIndex);

            recentBody.innerHTML = pageFlights.map(f => `
                <tr>
                    <td style="color:#aaa;">${new Date(f.timestamp).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</td>
                    <td><strong>${f.name}</strong> <span style="color:#666;">(${f.cid})</span></td>
                    <td>${f.route}</td>
                </tr>
            `).join('');

            document.getElementById('dashboardRecentPageIndicator').textContent = `Страница ${window.currentDashboardRecentPage} / ${totalPages}`;
            document.getElementById('dashboardRecentPrevBtn').disabled = window.currentDashboardRecentPage === 1;
            document.getElementById('dashboardRecentNextBtn').disabled = window.currentDashboardRecentPage === totalPages;
        };

        window.changeDashboardRecentPage = function(direction) {
            window.currentDashboardRecentPage += direction;
            window.renderDashboardRecentFlights();
        };

        async function initApp() {
            await validatePilotSession();
            await restoreAdminSession(); 

            listenToEvents(); 
            listenToLiveries();
            listenToPilots(); 
            listenToAdmins(); 
            listenToPilotDiscord();
            listenToMessengerBlocks();
            listenToSupportBlocks();
            listenToRecentFlights();
            
            renderRoster({ pilots: [], controllers: [] }); 
            window.updateProfileWidget(); 
            
            await loadFlightsFromFirebase();
            await fetchVatsimData();

            window._checkPendingHighlight();

            setInterval(fetchVatsimData, 60000); 
        }

        initApp();
