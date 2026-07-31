import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc } from "firebase/firestore";

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

        const recentSnap = await getDoc(doc(db, 'vatsim_history', 'recent_flights_log'));
        let recentFlightsData = (recentSnap.exists() && recentSnap.data().flights) ? recentSnap.data().flights : [];

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

                // Проверка на позывной CLR и запись в последние полеты
                if (callsign.toUpperCase().includes('CLR') && route !== '??? ➔ ???') {
                    const flightId = `${localPilot.cid}_${callsign}_${route}`;
                    const isAlreadyLogged = recentFlightsData.some(f => f.cid === localPilot.cid && f.flightId === flightId);

                    if (!isAlreadyLogged) {
                        console.log(`Найден новый полет: ${callsign} от ${localPilot.name}`);
                        recentFlightsData.unshift({
                            flightId: flightId,
                            cid: localPilot.cid,
                            name: localPilot.name,
                            callsign: callsign,
                            route: route,
                            aircraft: aircraft,
                            timestamp: new Date().toISOString()
                        });
                        
                        if (recentFlightsData.length > 60) {
                            recentFlightsData = recentFlightsData.slice(0, 60);
                        }

                        await setDoc(doc(db, 'vatsim_history', 'recent_flights_log'), { 
                            flights: recentFlightsData 
                        }, { merge: true });
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
