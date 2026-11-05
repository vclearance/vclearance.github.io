/* Живая карта пилотов vClearance (страница «Участники»).
   Берёт window.lastVatsimData и window.MY_PILOTS из main.js; main.js вызывает
   window.updateLiveMap(data) при каждом обновлении ростера (раз в минуту). */
(function () {
    const box = document.getElementById('liveMap');
    if (!box) return;

    let map = null, planesLayer = null, routeLayer = null, airportsDb = null;
    let pinnedCid = null, fitted = false, libsPromise = null;
    let lastData = null;

    function loadScript(src) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src; s.onload = res; s.onerror = () => rej(new Error('load failed ' + src));
            document.head.appendChild(s);
        });
    }
    function ensureLibs() {
        if (window.L) return Promise.resolve();
        if (!libsPromise) {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
            document.head.appendChild(css);
            libsPromise = loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js');
        }
        return libsPromise;
    }
    async function ensureAirports() {
        if (airportsDb) return airportsDb;
        const r = await fetch(box.dataset.airports);
        airportsDb = await r.json();
        return airportsDb;
    }

    function esc(s) {
        return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function isClearance(callsign) {
        const c = (callsign || '').toUpperCase();
        return c.includes('CLR') || c.includes('CLF');
    }
    function aircraftType(fp) {
        if (!fp) return '---';
        if (fp.aircraft_short) return fp.aircraft_short;
        const a = fp.aircraft || '';
        return (a.includes('/') ? a.split('/')[1] || a.split('/')[0] : a).trim() || '---';
    }

    /* ---- дуга большого круга (прямая на коротких дистанциях) ---- */
    function haversineKm(a, b) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    function arc(a, b) {
        const rad = Math.PI / 180, deg = 180 / Math.PI;
        const km = haversineKm(a, b);
        const n = Math.min(64, Math.max(2, Math.ceil(km / 150)));
        const d = km / 6371;
        const [la1, lo1, la2, lo2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
        const pts = [];
        let prev = a[1];
        for (let i = 0; i <= n; i++) {
            const f = i / n;
            let lat, lon;
            if (d < 1e-6) { lat = a[0]; lon = a[1]; }
            else {
                const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
                const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
                const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
                const z = A * Math.sin(la1) + B * Math.sin(la2);
                lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * deg;
                lon = Math.atan2(y, x) * deg;
            }
            while (lon - prev > 180) lon -= 360;
            while (lon - prev < -180) lon += 360;
            prev = lon;
            pts.push([lat, lon]);
        }
        return pts;
    }
    // сдвигает всю дугу на кратное 360° так, чтобы её конец совпал по долготе с self
    function alignEnd(pts, lon) {
        const shift = Math.round((lon - pts[pts.length - 1][1]) / 360) * 360;
        return shift ? pts.map(p => [p[0], p[1] + shift]) : pts;
    }
    function alignStart(pts, lon) {
        const shift = Math.round((lon - pts[0][1]) / 360) * 360;
        return shift ? pts.map(p => [p[0], p[1] + shift]) : pts;
    }

    /* ---- иконка самолёта ---- */
    function planeIcon(heading, highlight) {
        const size = highlight ? 34 : 24;
        const color = highlight ? '#2ecc71' : '#4aa3ff';
        const ring = highlight ? '<span class="lm-ring"></span>' : '';
        return L.divIcon({
            className: 'lm-plane' + (highlight ? ' lm-hl' : ''),
            html: ring + `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${Math.round(heading || 0)}deg); display:block; filter:drop-shadow(0 1px 3px rgba(0,0,0,.8));">`
                + `<path d="M12 1.5c.9 0 1.6.9 1.6 2v5.2l8.4 4.9v2.2l-8.4-2.4v4.6l2.3 1.8v1.7L12 20.6 8.1 21.5v-1.7l2.3-1.8v-4.6L2 15.8v-2.2l8.4-4.9V3.5c0-1.1.7-2 1.6-2z" fill="${color}" stroke="#0d0d0d" stroke-width="1"/></svg>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            tooltipAnchor: [0, -size / 2]
        });
    }

    function clearRoute() { if (routeLayer) routeLayer.clearLayers(); }

    function drawRoute(p) {
        clearRoute();
        const fp = p.flight_plan;
        if (!fp || !airportsDb) return;
        const pos = [p.latitude, p.longitude];
        const dep = airportsDb[(fp.departure || '').toUpperCase()];
        const arr = airportsDb[(fp.arrival || '').toUpperCase()];
        const hl = isClearance(p.callsign);
        const color = hl ? '#2ecc71' : '#4aa3ff';
        if (dep) {
            const pts = alignEnd(arc([dep[0], dep[1]], pos), pos[1]);
            L.polyline(pts, { color, weight: 2.5, opacity: .9 }).addTo(routeLayer);
            L.circleMarker(pts[0], { radius: 4, color, weight: 2, fillColor: '#0d0d0d', fillOpacity: 1 })
                .bindTooltip(esc((fp.departure || '').toUpperCase()), { permanent: true, direction: 'top', className: 'lm-apt' })
                .addTo(routeLayer);
        }
        if (arr) {
            const pts = alignStart(arc(pos, [arr[0], arr[1]]), pos[1]);
            L.polyline(pts, { color, weight: 2, opacity: .8, dashArray: '6 8' }).addTo(routeLayer);
            L.circleMarker(pts[pts.length - 1], { radius: 4, color, weight: 2, fillColor: '#0d0d0d', fillOpacity: 1 })
                .bindTooltip(esc((fp.arrival || '').toUpperCase()), { permanent: true, direction: 'top', className: 'lm-apt' })
                .addTo(routeLayer);
        }
    }

    function tooltipHtml(p, name) {
        const fp = p.flight_plan;
        const dep = fp && fp.departure ? esc(fp.departure.toUpperCase()) : '???';
        const arr = fp && fp.arrival ? esc(fp.arrival.toUpperCase()) : '???';
        const alt = Number.isFinite(p.altitude) ? Math.round(p.altitude / 100) * 100 : null;
        return `<strong>${esc(p.callsign)}</strong>${name ? ' · ' + esc(name) : ''}<br>`
            + `${esc(aircraftType(fp))} · ${dep} \u2794 ${arr}<br>`
            + `<span style="opacity:.7">${alt !== null ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0') : ''}${p.groundspeed ? ' · ' + p.groundspeed + ' kt' : ''}</span>`;
    }

    async function render(data) {
        lastData = data;
        const info = document.getElementById('liveMapInfo');
        try {
            await renderInner(data, info);
        } catch (e) {
            console.error('Живая карта: ошибка', e);
            if (info) info.textContent = 'Не удалось отобразить карту: ' + (e && e.message ? e.message : e);
        }
    }

    async function renderInner(data, info) {
        await Promise.all([ensureLibs(), ensureAirports()]);
        if (!map) {
            map = L.map(box, { worldCopyJump: true, minZoom: 2 }).setView([50, 30], 3);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 12
            }).addTo(map);
            planesLayer = L.layerGroup().addTo(map);
            routeLayer = L.layerGroup().addTo(map);
            map.on('click', () => { pinnedCid = null; clearRoute(); });
        }

        const mine = new Map((window.MY_PILOTS || []).map(p => [p.cid.toString(), p.name]));
        const flying = (data.pilots || []).filter(p => mine.has(p.cid.toString()) && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

        planesLayer.clearLayers();
        let hlCount = 0;
        const bounds = [];
        let pinnedPilot = null;
        flying.forEach(p => {
            const hl = isClearance(p.callsign);
            if (hl) hlCount++;
            const m = L.marker([p.latitude, p.longitude], { icon: planeIcon(p.heading, hl), zIndexOffset: hl ? 1000 : 0, riseOnHover: true })
                .bindTooltip(tooltipHtml(p, mine.get(p.cid.toString())), { direction: 'top', className: 'lm-tip' })
                .addTo(planesLayer);
            m.on('mouseover', () => drawRoute(p));
            m.on('mouseout', () => { if (pinnedCid === p.cid) return; clearRoute(); if (pinnedCid) { const pp = flying.find(x => x.cid === pinnedCid); if (pp) drawRoute(pp); } });
            m.on('click', e => { L.DomEvent.stopPropagation(e); pinnedCid = p.cid; drawRoute(p); });
            if (p.cid === pinnedCid) pinnedPilot = p;
            bounds.push([p.latitude, p.longitude]);
        });

        clearRoute();
        if (pinnedPilot) drawRoute(pinnedPilot); else pinnedCid = null;

        if (!fitted && bounds.length) {
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 5 });
            fitted = true;
        }
        setTimeout(() => map.invalidateSize(), 100);

        if (info) {
            info.textContent = flying.length
                ? `В сети пилотов vClearance: ${flying.length} · из них CLR/CLF: ${hlCount}`
                : 'Сейчас никто из участников не летит в сети VATSIM.';
        }
    }

    // main.js по-прежнему может вызывать updateLiveMap при обновлении ростера,
    // но карта больше от этого не зависит: сама опрашивает публичный API VATSIM.
    window.updateLiveMap = render;

    let polling = false;
    async function poll() {
        if (polling) return;
        polling = true;
        try {
            const r = await fetch('https://data.vatsim.net/v3/vatsim-data.json', { cache: 'no-store' });
            if (!r.ok) throw new Error('VATSIM API: HTTP ' + r.status);
            const data = await r.json();
            window.lastVatsimData = data;
            await render(data);
        } catch (e) {
            console.error('Живая карта: не удалось получить данные VATSIM', e);
            const info = document.getElementById('liveMapInfo');
            if (info && !map) info.textContent = 'Не удалось получить данные VATSIM.';
        } finally {
            polling = false;
        }
    }
    poll();
    setInterval(() => { if (!document.hidden) poll(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
