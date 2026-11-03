import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, query, orderBy, limit } from "firebase/firestore";

// Твой конфиг Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCa2nr-heFF5LqoqN_tPYGJpf9PGhqMydo",
    authDomain: "vclearance-15b43.firebaseapp.com",
    projectId: "vclearance-15b43",
    storageBucket: "vclearance-15b43.firebasestorage.app",
    messagingSenderId: "299361728910",
    appId: "1:299361728910:web:7e77b2f4431db23a66ccdf"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Через сколько часов один и тот же полёт (тот же cid+callsign+route) можно
// засчитывать как НОВЫЙ вылет, а не продолжение текущего. Бот опрашивает VATSIM
// каждые 5 минут, поэтому без такого окна один и тот же полёт писался бы
// в историю десятки раз, пока пилот не сменит callsign/маршрут.
const DEDUPE_WINDOW_HOURS = 6;

// Функция для записи системных логов бота
async function logSystemAudit(action, details) {
    try {
        await addDoc(collection(db, 'audit_logs'), {
            timestamp: new Date().toISOString(),
            adminCid: 'Система (Бот)',
            action: action,
            details: details
        });
    } catch (error) {
        console.error("Ошибка записи системного аудита:", error);
    }
}

const BASE_PILOTS = [
    { cid: "1816284", name: "Karim I." }
];

function cleanAircraftType(aircraftStr) {
    if (!aircraftStr) return '---';
    if (aircraftStr.includes('/')) return aircraftStr.split('/')[0].trim();
    return aircraftStr.trim();
}

async function run() {
    console.log("Начинаем проверку VATSIM...");
    try {
        // 1. Получаем список пилотов из базы
        const pilotsSnap = await getDocs(collection(db, 'custom_pilots'));
        let customPilots = [];
        pilotsSnap.forEach(docSnap => customPilots.push(docSnap.data()));
        const MY_PILOTS = [...BASE_PILOTS, ...customPilots];

        // 2. Получаем текущую историю из базы
        const cacheSnap = await getDoc(doc(db, 'vatsim_history', 'roster'));
        let firebaseFlightsCache = cacheSnap.exists() ? cacheSnap.data() : {};

        // Читаем последние полёты из подколлекции recent_flights (много отдельных
        // документов со случайными id, а не один документ с массивом). Это убирает
        // гонку записи между ботом и открытыми вкладками сайта, из-за которой
        // полёты пропадали при одновременной перезаписи одного и того же документа.
        const recentQ = query(collection(db, 'recent_flights'), orderBy('timestamp', 'desc'), limit(300));
        const recentSnap = await getDocs(recentQ);
        // Для дедупликации храним время ПОСЛЕДНЕЙ известной записи по каждому flightId,
        // а не сам факт "когда-либо был залогирован" — это позволяет засчитывать
        // повторные вылеты тем же маршрутом после DEDUPE_WINDOW_HOURS.
        let lastSeenAt = new Map();
        recentSnap.forEach(d => {
            const data = d.data();
            const prev = lastSeenAt.get(data.flightId);
            if (!prev || new Date(data.timestamp) > new Date(prev)) {
                lastSeenAt.set(data.flightId, data.timestamp);
            }
        });

        // 3. Скачиваем данные VATSIM
        const response = await fetch('https://data.vatsim.net/v3/vatsim-data.json');
        const data = await response.json();

        let needUpdateFirebase = false;

        // 4. Проверяем каждого пилота
        for (const localPilot of MY_PILOTS) {
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

                if (!firebaseFlightsCache[localPilot.cid] || firebaseFlightsCache[localPilot.cid].callsign !== callsign) {
                    firebaseFlightsCache[localPilot.cid] = { type: 'pilot', callsign, aircraft, route };
                    needUpdateFirebase = true;
                }

                // Проверка на позывной CLR или CLF и запись в последние полеты
                const upperCallsign = callsign.toUpperCase();
                if ((upperCallsign.includes('CLR') || upperCallsign.includes('CLF')) && route !== '??? ➔ ???') {
                    const flightId = `${localPilot.cid}_${callsign}_${route}`;
                    const lastSeen = lastSeenAt.get(flightId);
                    const hoursSinceLastSeen = lastSeen
                        ? (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60)
                        : Infinity;

                    if (hoursSinceLastSeen >= DEDUPE_WINDOW_HOURS) {
                        console.log(`Найден новый полет: ${callsign} от ${localPilot.name}`);
                        const nowIso = new Date().toISOString();
                        lastSeenAt.set(flightId, nowIso);

                        // addDoc со случайным id — каждый полёт отдельным документом.
                        // Это исключает и гонку записи (нет общего документа, который можно
                        // перезаписать поверх чужих изменений), и проблему повторных вылетов
                        // (id больше не завязан на flightId, так что один и тот же маршрут
                        // может быть залогирован сколько угодно раз с разными id документов).
                        await addDoc(collection(db, 'recent_flights'), {
                            flightId: flightId,
                            cid: localPilot.cid,
                            name: localPilot.name,
                            callsign: callsign,
                            route: route,
                            aircraft: aircraft,
                            timestamp: nowIso
                        });
                    }
                }

            } else if (onlineController) {
                const callsign = onlineController.callsign || '---';
                if (!firebaseFlightsCache[localPilot.cid] || firebaseFlightsCache[localPilot.cid].callsign !== callsign || firebaseFlightsCache[localPilot.cid].type !== 'controller') {
                    firebaseFlightsCache[localPilot.cid] = { type: 'controller', callsign, aircraft: 'ATC', route: '---' };
                    needUpdateFirebase = true;
                }
            }
        }

        // 5. Запись результатов и логов аудита
        if (needUpdateFirebase) {
            await setDoc(doc(db, 'vatsim_history', 'roster'), firebaseFlightsCache, { merge: true });
            console.log("Кэш ростера обновлен.");
            await logSystemAudit('Системная проверка', 'Данные обновлены: найдены изменения в сети');
        } else {
            console.log("Изменений нет.");
            await logSystemAudit('Системная проверка', 'Проверка завершена. Изменений у пилотов нет');
        }

    } catch (error) {
        console.error("Ошибка во время выполнения:", error);
        
        // Дополнительно можно логировать ошибки, если бот сломался
        try {
            await logSystemAudit('Системная ошибка', error.message || 'Неизвестная ошибка скрипта');
        } catch(e) {}
        
        process.exit(1);
    }
    
    console.log("Проверка завершена.");
    process.exit(0); // Обязательно закрываем процесс, иначе GitHub Action зависнет
}

run();
