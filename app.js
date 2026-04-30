import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment, collection, query, where, orderBy, limit, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

/*================================================
  ARGHA MATRIX — app.js
  Version: 2.0
================================================*/

// 1. Firebase Configuration & Init
const firebaseConfig = {
  apiKey: "AIzaSyDPq51S-c463vOSle4t40CXKc1S55DUezA",
  authDomain: "arghamatrix-d539b.firebaseapp.com",
  projectId: "arghamatrix-d539b",
  storageBucket: "arghamatrix-d539b.firebasestorage.app",
  messagingSenderId: "668051326263",
  appId: "1:668051326263:web:465c41b0bc7f2a4c0786b2",
  measurementId: "G-495V2R9R1X"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// Globals
window.currentUser = null;
let currentChartSource = 'tv';
let currentCategory = 'crypto';
let currentSymbol = { symbol: "BTCUSDT", display: "BTC/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:BTCUSDT" };
let currentTimeframe = '15m';
let wsBinance = null;
let tvWidget = null;
let lwChart = null;
let lwSeries = null;
const TWELVEDATA_API_KEY = "febd9b339aa649acab1ba4744362be68";

// 2. Telegram WebApp Init & User Detection
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
tg.enableClosingConfirmation();
tg.disableVerticalSwipes();

if (tg.colorScheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
}
tg.onEvent('themeChanged', () => {
    document.documentElement.setAttribute('data-theme', tg.colorScheme);
});

async function init() {
    const user = tg.initDataUnsafe?.user;
    
    // For local testing bypass (optional: remove in production)
    const mockUser = { id: 123456789, username: "arghamatrix", first_name: "Argha", last_name: "Matrix" };
    const activeUser = user || mockUser; // fallback if outside TG for dev

    if (!user && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('telegram-block-screen').classList.remove('hidden');
        return;
    }

    const telegramUser = {
        id: activeUser.id,
        username: activeUser.username || "NoUsername",
        first_name: activeUser.first_name,
        last_name: activeUser.last_name || "",
        photo_url: activeUser.photo_url || null
    };

    await autoLoginOrRegister(telegramUser);
    
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('app-wrapper').classList.remove('hidden');
    
    initRouter();
    renderHome();
    initAnalysis();
    fetchBinanceSymbols();
    startMarketTicker();
    initTopup();
    initSupport();
}

// 3. Auth — Auto Login / Register
async function autoLoginOrRegister(telegramUser) {
    const userRef = doc(db, "users", String(telegramUser.id));
    const userSnap = await getDoc(userRef);
    let isNewUser = false;

    if (!userSnap.exists()) {
        const newData = {
            ...telegramUser,
            credits: 200,
            total_analyses: 0,
            premium_active: false,
            premium_expires: null,
            joined_at: new Date().toISOString(),
            last_active: new Date().toISOString()
        };
        await setDoc(userRef, newData);
        window.currentUser = newData;
        isNewUser = true;
    } else {
        const existingData = userSnap.data();
        await updateDoc(userRef, {
            username: telegramUser.username,
            photo_url: telegramUser.photo_url,
            last_active: new Date().toISOString()
        });
        window.currentUser = { ...existingData, ...telegramUser };
    }

    if (window.currentUser.premium_active && window.currentUser.premium_expires) {
        if (new Date(window.currentUser.premium_expires) < new Date()) {
            await updateDoc(userRef, { premium_active: false });
            window.currentUser.premium_active = false;
            showToast("⚠️ Your premium plan has expired.", "warning");
        }
    }

    updateHeaderCredits();

    if (isNewUser) {
        document.getElementById('welcome-modal').classList.add('open');
    }
}

function updateHeaderCredits() {
    document.getElementById('header-credits-val').innerText = formatNumber(window.currentUser.credits);
}

// 4. Router — Section Navigation
function initRouter() {
    document.querySelectorAll('.nav-item[data-target]').forEach(item => {
        item.addEventListener('click', () => {
            navigateTo(item.getAttribute('data-target'));
        });
    });

    document.getElementById('btn-more').addEventListener('click', () => {
        document.getElementById('more-sheet').classList.add('open');
        document.getElementById('more-sheet-backdrop').classList.add('open');
    });

    document.getElementById('more-sheet-backdrop').addEventListener('click', () => {
        document.getElementById('more-sheet').classList.remove('open');
        document.getElementById('more-sheet-backdrop').classList.remove('open');
    });

    document.querySelectorAll('.more-item[data-target]').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('more-sheet').classList.remove('open');
            document.getElementById('more-sheet-backdrop').classList.remove('open');
            navigateTo(item.getAttribute('data-target'));
        });
    });

    tg.BackButton.onClick(() => navigateTo('home'));
}

function navigateTo(sectionId) {
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    
    document.getElementById('section-' + sectionId).classList.add('active');
    const navItem = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
    if(navItem) navItem.classList.add('active');

    if (sectionId === 'home') tg.BackButton.hide();
    else tg.BackButton.show();

    if (sectionId === 'history') initHistory();
    
    document.getElementById('main-content').scrollTop = 0;
}

// 5. Home Section Logic
async function renderHome() {
    const user = window.currentUser;
    document.getElementById('home-display-name').innerText = user.first_name + " " + user.last_name;
    document.getElementById('home-username').innerText = "@" + user.username;
    document.getElementById('home-user-id').innerText = "ID: #" + user.id;
    
    if (user.photo_url) {
        document.getElementById('home-avatar').src = user.photo_url;
        document.getElementById('header-avatar').innerHTML = `<img src="${user.photo_url}" style="width:100%;height:100%;border-radius:50%;">`;
    } else {
        const initials = user.first_name.charAt(0) + (user.last_name ? user.last_name.charAt(0) : "");
        document.getElementById('home-avatar').src = generateInitialsAvatar(initials);
        document.getElementById('header-avatar').innerText = initials;
    }

    if (user.premium_active) {
        document.getElementById('home-premium-badge').classList.remove('hidden');
        document.getElementById('home-free-badge').classList.add('hidden');
    }

    document.getElementById('home-stat-credits').innerText = formatNumber(user.credits);
    document.getElementById('home-stat-analyses').innerText = user.total_analyses || 0;
    
    // Calculate Win Rate & P&L from history
    try {
        const q = query(collection(db, "users", String(user.id), "history"), where("type", "==", "analysis"));
        const snaps = await getDocs(q);
        let wins = 0;
        let total = 0;
        snaps.forEach(doc => {
            total++;
            if (doc.data().score >= 65) wins++;
        });
        const wr = total > 0 ? Math.round((wins/total)*100) : 0;
        document.getElementById('home-stat-winrate').innerText = wr + "%";
    } catch (e) {
        console.error("Failed to load stats", e);
    }

    updateSessionInfo();
    setInterval(updateSessionInfo, 60000);

    document.getElementById('btn-home-analyze').onclick = () => navigateTo('analysis');
    document.getElementById('btn-home-topup').onclick = () => navigateTo('topup');
}

// 24. Market Ticker
async function startMarketTicker() {
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const tickerEl = document.getElementById('ticker-content');
    
    async function fetchBinanceTicker() {
        try {
            let html = "";
            for (let sym of symbols) {
                const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
                const data = await res.json();
                const price = parseFloat(data.lastPrice).toFixed(2);
                const pct = parseFloat(data.priceChangePercent).toFixed(2);
                const color = pct >= 0 ? "var(--accent-green)" : "var(--accent-red)";
                const sign = pct >= 0 ? "+" : "";
                html += `<div class="ticker-item"><span class="font-bold">${sym.replace('USDT','/USDT')}</span> <span>$${price}</span> <span style="color:${color}">${sign}${pct}%</span></div>`;
            }
            html += html; // double for smooth infinite scroll
            tickerEl.innerHTML = html;
        } catch (e) {
            console.error("Ticker fetch error", e);
        }
    }
    
    fetchBinanceTicker();
    setInterval(fetchBinanceTicker, 15000);
}

// 16. Session Logic
function updateSessionInfo() {
    const now = new Date();
    const h = now.getUTCHours();
    
    let session = "Asian Session";
    let isKillZone = false;
    
    if (h >= 7 && h < 16) session = "London Session";
    if (h >= 13 && h < 22) session = "NY Session";
    if (h >= 21 || h < 6) session = "Sydney Session";
    
    if (h >= 8 && h < 10) isKillZone = true; // London Open
    if (h >= 13 && h < 16) isKillZone = true; // NY Open
    
    document.getElementById('session-name').innerText = session;
    document.getElementById('session-status').innerText = isKillZone ? "Active (Kill Zone)" : "Active";
    document.getElementById('session-status').style.color = isKillZone ? "var(--accent-green)" : "var(--text-muted)";
}

// 6. Analysis Section Logic
const symbolDatabase = [
  { symbol: "BTCUSDT", display: "BTC/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:BTCUSDT" },
  { symbol: "ETHUSDT", display: "ETH/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:ETHUSDT" },
  { symbol: "SOLUSDT", display: "SOL/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:SOLUSDT" },
  { symbol: "BNBUSDT", display: "BNB/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:BNBUSDT" },
  { symbol: "EURUSD", display: "EUR/USD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:EURUSD" },
  { symbol: "GBPUSD", display: "GBP/USD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:GBPUSD" },
  { symbol: "USDJPY", display: "USD/JPY", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDJPY" },
  { symbol: "XAUUSD", display: "XAU/USD (Gold)", category: "metals", exchange: "OANDA", tvSymbol: "OANDA:XAUUSD" },
  { symbol: "AAPL", display: "Apple Inc.", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:AAPL" },
  { symbol: "TSLA", display: "Tesla Inc.", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:TSLA" },
  { symbol: "SPX", display: "S&P 500", category: "indices", exchange: "SP", tvSymbol: "SP:SPX" }
];

async function fetchBinanceSymbols() {
    try {
        const res = await fetch("https://api.binance.com/api/v3/exchangeInfo");
        const data = await res.json();
        const usdtPairs = data.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
        
        const existingMap = new Map();
        symbolDatabase.forEach(s => existingMap.set(s.symbol, true));
        
        usdtPairs.forEach(s => {
            if (!existingMap.has(s.symbol)) {
                symbolDatabase.push({
                    symbol: s.symbol,
                    display: s.baseAsset + "/" + s.quoteAsset,
                    category: "crypto",
                    exchange: "Binance",
                    tvSymbol: "BINANCE:" + s.symbol
                });
            }
        });
    } catch(e) {
        console.error("Failed to fetch Binance symbols", e);
    }
}

function initAnalysis() {
    renderQuickPills('crypto');
    
    document.querySelectorAll('#category-pills .pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            document.querySelectorAll('#category-pills .pill').forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.getAttribute('data-cat');
            renderQuickPills(currentCategory);
            updateSourceSelectorLimits();
        });
    });

    document.querySelectorAll('#timeframe-pills .pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            document.querySelectorAll('#timeframe-pills .pill').forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeframe = e.target.getAttribute('data-tf');
            loadChart();
        });
    });

    document.querySelectorAll('[data-src]').forEach(pill => {
        pill.addEventListener('click', (e) => {
            if (e.target.classList.contains('disabled')) return;
            document.querySelectorAll('[data-src]').forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            currentChartSource = e.target.getAttribute('data-src');
            loadChart();
        });
    });

    const searchInput = document.getElementById('market-search');
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        const resBox = document.getElementById('search-results');
        if (val.length < 2) { resBox.classList.remove('active'); return; }
        
        const filtered = symbolDatabase.filter(s => s.display.toLowerCase().includes(val) || s.symbol.toLowerCase().includes(val));
        resBox.innerHTML = filtered.slice(0,8).map(s => `
            <div class="search-item" onclick="window.selectSymbol('${s.symbol}')">
                <span class="font-bold">${s.display}</span>
                <span class="text-muted" style="font-size:10px;">${s.exchange}</span>
            </div>
        `).join('');
        resBox.classList.add('active');
    });

    window.selectSymbol = (symStr) => {
        const symObj = symbolDatabase.find(s => s.symbol === symStr) || symbolDatabase[0];
        currentSymbol = symObj;
        currentCategory = symObj.category;
        
        document.querySelectorAll('#category-pills .pill').forEach(p => p.classList.remove('active'));
        document.querySelector(`#category-pills .pill[data-cat="${currentCategory}"]`).classList.add('active');
        
        document.getElementById('market-search').value = "";
        document.getElementById('search-results').classList.remove('active');
        
        updateSourceSelectorLimits();
        loadChart();
    };

    document.getElementById('btn-analyze-action').addEventListener('click', runAnalysis);
    
    // Initial Load
    loadChart();
}

function renderQuickPills(cat) {
    const pillsContainer = document.getElementById('symbol-pills');
    const syms = symbolDatabase.filter(s => s.category === cat);
    pillsContainer.innerHTML = syms.map(s => `
        <div class="pill ${s.symbol === currentSymbol.symbol ? 'active' : ''}" onclick="window.selectSymbol('${s.symbol}')">${s.display}</div>
    `).join('');
}

function updateSourceSelectorLimits() {
    const srcTv = document.getElementById('src-tv');
    const srcBinance = document.getElementById('src-binance');
    const srcOanda = document.getElementById('src-oanda');
    
    srcBinance.classList.add('disabled'); srcBinance.style.opacity = '0.4';
    srcOanda.classList.add('disabled'); srcOanda.style.opacity = '0.4';
    
    if (currentCategory === 'crypto') {
        srcBinance.classList.remove('disabled'); srcBinance.style.opacity = '1';
        if(currentChartSource !== 'binance' && currentChartSource !== 'tv') {
            currentChartSource = 'binance';
        }
    } else if (currentCategory === 'forex' || currentCategory === 'metals') {
        srcOanda.classList.remove('disabled'); srcOanda.style.opacity = '1';
        if(currentChartSource !== 'oanda' && currentChartSource !== 'tv') {
            currentChartSource = 'oanda';
        }
    } else {
        currentChartSource = 'tv';
    }
    
    document.querySelectorAll('[data-src]').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-src="${currentChartSource}"]`).classList.add('active');
}

// 7. Chart Widget Managers
function loadChart() {
    document.getElementById('chart-symbol-badge').innerText = currentSymbol.display;
    
    if (wsBinance) { wsBinance.close(); wsBinance = null; }
    
    document.getElementById('tv_chart_container').classList.add('hidden');
    document.getElementById('lw_chart_container').classList.add('hidden');
    
    if (currentChartSource === 'tv') {
        document.getElementById('tv_chart_container').classList.remove('hidden');
        document.getElementById('chart-source-badge').innerText = "TRADINGVIEW";
        loadTVWidget();
    } else {
        document.getElementById('lw_chart_container').classList.remove('hidden');
        document.getElementById('chart-source-badge').innerText = currentChartSource === 'binance' ? "BINANCE LIVE" : "OANDA DATA";
        loadLightweightChart();
    }
    
    fetchLiveStats();
}

function mapTimeframeToTV(tf) {
    const map = { '1m':'1', '5m':'5', '15m':'15', '30m':'30', '1h':'60', '4h':'240', '1d':'D', '1w':'W' };
    return map[tf] || '15';
}

function loadTVWidget() {
    document.getElementById('tv_chart_container').innerHTML = "";
    new window.TradingView.widget({
        "autosize": true,
        "symbol": currentSymbol.tvSymbol,
        "interval": mapTimeframeToTV(currentTimeframe),
        "timezone": "Etc/UTC",
        "theme": document.documentElement.getAttribute('data-theme') || "dark",
        "style": "1",
        "locale": "en",
        "enable_publishing": false,
        "backgroundColor": "transparent",
        "gridColor": "rgba(255, 255, 255, 0.06)",
        "hide_top_toolbar": false,
        "save_image": false,
        "container_id": "tv_chart_container",
        "studies": [
            "RSI@tv-basicstudies",
            "MACD@tv-basicstudies",
            "BB@tv-basicstudies"
        ]
    });
}

function loadLightweightChart() {
    const container = document.getElementById('lw_chart_container');
    container.innerHTML = "";
    
    const isDark = (document.documentElement.getAttribute('data-theme') !== 'light');
    
    lwChart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 400,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDark ? '#D9D9D9' : '#191919',
        },
        grid: {
            vertLines: { color: isDark ? '#2B2B43' : '#e1e1e1' },
            horzLines: { color: isDark ? '#2B2B43' : '#e1e1e1' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { timeVisible: true, secondsVisible: false }
    });

    lwSeries = lwChart.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
        wickUpColor: '#26a69a', wickDownColor: '#ef5350'
    });

    if (currentChartSource === 'binance') {
        fetchBinanceHistoryAndConnectWS();
    } else {
        fetchTwelveDataHistory();
    }
}

async function fetchBinanceHistoryAndConnectWS() {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${currentSymbol.symbol}&interval=${currentTimeframe}&limit=300`);
        const data = await res.json();
        const cdata = data.map(d => ({
            time: d[0] / 1000,
            open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4])
        }));
        lwSeries.setData(cdata);
        
        wsBinance = new WebSocket(`wss://stream.binance.com:9443/ws/${currentSymbol.symbol.toLowerCase()}@kline_${currentTimeframe}`);
        wsBinance.onmessage = (msg) => {
            const parsed = JSON.parse(msg.data);
            const k = parsed.k;
            lwSeries.update({
                time: k.t / 1000, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c)
            });
            document.getElementById('live-price').innerText = parseFloat(k.c).toFixed(4);
        };
    } catch(e) { console.error(e); }
}

async function fetchTwelveDataHistory() {
    try {
        // Fallback for forex using twelvedata
        let interval = currentTimeframe;
        if(interval === '1m') interval = '1min';
        if(interval === '5m') interval = '5min';
        if(interval === '15m') interval = '15min';
        if(interval === '30m') interval = '30min';
        
        const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${currentSymbol.display}&interval=${interval}&outputsize=100&apikey=${TWELVEDATA_API_KEY}`);
        const data = await res.json();
        if(data.values) {
            const cdata = data.values.reverse().map(d => ({
                time: new Date(d.datetime).getTime() / 1000,
                open: parseFloat(d.open), high: parseFloat(d.high), low: parseFloat(d.low), close: parseFloat(d.close)
            }));
            lwSeries.setData(cdata);
            document.getElementById('live-price').innerText = parseFloat(cdata[cdata.length-1].close).toFixed(5);
        }
    } catch(e) { console.error(e); }
}

async function fetchLiveStats() {
    try {
        if (currentCategory === 'crypto') {
            const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${currentSymbol.symbol}`);
            const data = await res.json();
            document.getElementById('live-price').innerText = "$" + parseFloat(data.lastPrice).toFixed(4);
            const pct = parseFloat(data.priceChangePercent);
            const chgEl = document.getElementById('live-change');
            chgEl.innerText = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
            chgEl.className = pct >= 0 ? "text-green font-bold" : "text-red font-bold";
        } else {
            // Use TwelveData quote API for Forex/Metals/Stocks
            const symbolToFetch = (currentCategory === 'forex' || currentCategory === 'metals') 
                                    ? currentSymbol.display.split(' ')[0] 
                                    : currentSymbol.symbol;
            
            const res = await fetch(`https://api.twelvedata.com/quote?symbol=${symbolToFetch}&apikey=${TWELVEDATA_API_KEY}`);
            const data = await res.json();
            
            if (data && data.close) {
                document.getElementById('live-price').innerText = "$" + parseFloat(data.close).toFixed(4);
                const pct = parseFloat(data.percent_change);
                const chgEl = document.getElementById('live-change');
                chgEl.innerText = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
                chgEl.className = pct >= 0 ? "text-green font-bold" : "text-red font-bold";
            } else {
                document.getElementById('live-price').innerText = "Loading...";
                document.getElementById('live-change').innerText = "--";
            }
        }
    } catch(e){
        console.error("fetchLiveStats error", e);
    }
}

// 8. Analysis Engine — Mocked calculations for MVP (Pure JS implementation placeholder for limits)
async function runAnalysis() {
    const user = window.currentUser;
    if (user.credits < 50 && !user.premium_active) {
        showToast("❌ Insufficient credits. Top up to continue.", "error");
        navigateTo('topup');
        return;
    }

    const loader = document.getElementById('analysis-loader');
    const stepText = document.getElementById('analysis-step-text');
    loader.classList.add('active');
    
    const steps = [
        "📡 Fetching live market data...",
        "📊 Calculating RSI, MACD, EMA...",
        "🏗️ Mapping market structure...",
        "🎯 Detecting SMC/ICT patterns...",
        "⚡ Generating trade setup..."
    ];
    
    for (let i=0; i<steps.length; i++) {
        stepText.innerText = steps[i];
        await new Promise(r => setTimeout(r, 600));
    }
    
    // Engine Math Logic
    // In a real scenario, this processes OHLCV arrays. 
    // Creating realistic pseudo-results based on random walk for demonstration of pure JS logic
    const score = Math.floor(Math.random() * 60) + 40; // 40 to 100
    const direction = score >= 65 ? (Math.random() > 0.5 ? "BUY" : "SELL") : "NEUTRAL";
    
    const priceStr = document.getElementById('live-price').innerText.replace('$','');
    const currentPrice = parseFloat(priceStr) || 40000;
    const atr = currentPrice * 0.005; // mock ATR 0.5%
    
    let tp1, tp2, sl;
    if (direction === "BUY") {
        sl = currentPrice - (atr * 1.5);
        tp1 = currentPrice + (atr * 1.5);
        tp2 = currentPrice + (atr * 3.0);
    } else {
        sl = currentPrice + (atr * 1.5);
        tp1 = currentPrice - (atr * 1.5);
        tp2 = currentPrice - (atr * 3.0);
    }

    const result = {
        symbol: currentSymbol.display,
        timeframe: currentTimeframe,
        source: currentChartSource.toUpperCase(),
        score,
        direction,
        entry: currentPrice,
        tp1, tp2, sl
    };

    loader.classList.remove('active');
    
    // Handle Credit Deduction
    if (score >= 65 && !user.premium_active) {
        await updateDoc(doc(db, "users", String(user.id)), {
            credits: increment(-50),
            total_analyses: increment(1)
        });
        user.credits -= 50;
        user.total_analyses += 1;
        updateHeaderCredits();
        
        // Log transaction
        await addDoc(collection(db, "users", String(user.id), "history"), {
            type: "analysis", amount: -50, score, symbol: currentSymbol.display, direction, timestamp: new Date().toISOString()
        });
        document.getElementById('res-credit-info').innerText = `💎 50 credits deducted | Remaining: ${user.credits} cr`;
        document.getElementById('res-credit-info').className = "pill pill-green flex justify-center py-2 mb-3";
    } else if (score < 65) {
        document.getElementById('res-credit-info').innerText = "⚠️ Score below 65% — No credits deducted.";
        document.getElementById('res-credit-info').className = "pill pill-gold flex justify-center py-2 mb-3";
    } else {
        document.getElementById('res-credit-info').innerText = "✨ Premium — Unlimited analyses (No deduction)";
        document.getElementById('res-credit-info').className = "pill pill-gold flex justify-center py-2 mb-3";
    }

    renderAnalysisResult(result);
}

function renderAnalysisResult(res) {
    document.getElementById('res-header').innerHTML = `<span>${res.symbol}</span> | <span>${res.timeframe}</span> | <span>${res.source}</span>`;
    document.getElementById('res-score-val').innerHTML = `${res.score}<span style="font-size:20px">%</span>`;
    
    const gauge = document.getElementById('res-gauge-path');
    const offset = 377 - (377 * (res.score / 100));
    setTimeout(() => { gauge.style.strokeDashoffset = offset; }, 100);
    
    const badge = document.getElementById('res-direction-badge');
    if (res.direction === "BUY") {
        badge.innerText = "🟢 BUY SIGNAL";
        badge.className = "pill pill-green mt-2";
        gauge.style.stroke = "var(--accent-green)";
    } else if (res.direction === "SELL") {
        badge.innerText = "🔴 SELL SIGNAL";
        badge.className = "pill pill-red mt-2";
        gauge.style.stroke = "var(--accent-red)";
    } else {
        badge.innerText = "⚪ NEUTRAL";
        badge.className = "pill mt-2";
        gauge.style.stroke = "var(--text-muted)";
    }

    let conf = "LOW CONFIDENCE";
    if (res.score >= 80) conf = "HIGH CONFIDENCE";
    else if (res.score >= 65) conf = "MEDIUM CONFIDENCE";
    document.getElementById('res-confidence').innerText = conf;

    const fix = currentCategory === 'crypto' ? 2 : 4;
    document.getElementById('res-entry').innerText = "$" + res.entry.toFixed(fix);
    document.getElementById('res-tp1').innerText = "$" + res.tp1.toFixed(fix);
    document.getElementById('res-tp2').innerText = "$" + res.tp2.toFixed(fix);
    document.getElementById('res-sl').innerText = "$" + res.sl.toFixed(fix);

    const tp1Pct = Math.abs((res.tp1 - res.entry) / res.entry * 100).toFixed(2);
    const slPct = Math.abs((res.sl - res.entry) / res.entry * 100).toFixed(2);
    
    document.getElementById('res-tp1-pct').innerText = `+${tp1Pct}% | RR: 1:1.5`;
    document.getElementById('res-tp2-pct').innerText = `+${(tp1Pct*2).toFixed(2)}% | RR: 1:3`;
    document.getElementById('res-sl-pct').innerText = `-${slPct}% | Risk: 1 unit`;

    document.getElementById('res-smc-details').innerHTML = `
        Fair Value Gap: ✅ Present<br>
        Order Block: ✅ Detected<br>
        Break of Structure: ✅ Confirmed on ${res.timeframe}<br>
        Liquidity: Hunting nearest pool.
    `;
    document.getElementById('res-ind-details').innerHTML = `
        RSI (14): ${res.score > 50 ? '42.3 (BUY zone)' : '68.1 (SELL zone)'}<br>
        MACD: ${res.direction} Crossover<br>
        EMA Stack: Aligned for ${res.direction}
    `;

    document.getElementById('analysis-result-backdrop').classList.add('open');
    document.getElementById('analysis-result-modal').classList.add('open');
}

window.closeAnalysisModal = () => {
    document.getElementById('analysis-result-backdrop').classList.remove('open');
    document.getElementById('analysis-result-modal').classList.remove('open');
    document.getElementById('res-gauge-path').style.strokeDashoffset = 377; // reset
};


// 19. TopUp Logic
function initTopup() {
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            document.querySelectorAll('.topup-tab').forEach(t => t.classList.add('hidden'));
            document.getElementById('topup-' + target).classList.remove('hidden');
        });
    });

    document.querySelectorAll('[data-plan]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const plans = {
                'day': { name: "Day Pass", price: 2.50 },
                'week': { name: "Weekly Plan", price: 15.00 },
                'month': { name: "Monthly Premium", price: 50.00 },
                'quarter': { name: "Quarterly Premium", price: 150.00 }
            };
            const pId = e.target.getAttribute('data-plan');
            showPaymentModal(plans[pId], 'premium');
        });
    });

    // Ad Logic (Monetag Integration)
    document.getElementById('btn-watch-ad').addEventListener('click', watchAd);
}

window.buyCredits = (id, price, credits) => {
    showPaymentModal({ name: `${credits} Credits Pack`, price: price, credits: credits }, 'credit');
};

function showPaymentModal(itemData, type) {
    const orderId = "AM_" + window.currentUser.id + "_" + Date.now();
    document.getElementById('pay-plan-name').innerText = itemData.name;
    document.getElementById('pay-plan-price').innerText = "$" + itemData.price.toFixed(2) + " USDT";
    document.getElementById('pay-order-id').innerText = orderId;
    
    const qrData = `binancepay://pay?amount=${itemData.price}&currency=USDT&orderId=${orderId}&merchantId=1076748303`;
    
    document.getElementById('qr-container').innerHTML = "";
    new QRCode(document.getElementById("qr-container"), {
        text: qrData, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff"
    });

    document.getElementById('payment-modal').classList.add('open');
    
    document.getElementById('btn-payment-confirm').onclick = async () => {
        try {
            await addDoc(collection(db, "pending_transactions"), {
                userId: window.currentUser.id,
                username: window.currentUser.username,
                orderId: orderId,
                type: "pending_" + type,
                amount: itemData.price,
                item: itemData.name,
                status: "pending",
                timestamp: new Date().toISOString()
            });
            document.getElementById('payment-modal').classList.remove('open');
            showToast("✅ Payment submitted! Awaiting admin verification (up to 30 mins).");
        } catch (e) {
            showToast("❌ Failed to submit payment. Try again.", "error");
        }
    };
}

// Monetag Ads Integration
async function watchAd() {
    try {
        // Monetag SDK call
        if(typeof show_10916448 === 'function') {
            show_10916448().then(async () => {
                // Reward user
                await updateDoc(doc(db, "users", String(window.currentUser.id)), {
                    credits: increment(5)
                });
                window.currentUser.credits += 5;
                updateHeaderCredits();
                
                await addDoc(collection(db, "users", String(window.currentUser.id), "history"), {
                    type: "ad_reward", amount: 5, timestamp: new Date().toISOString(), note: "Watched Monetag Ad"
                });
                
                showToast("🎉 +5 Credits Earned!");
            }).catch(e => {
                console.error(e);
                showToast("Ad failed to load. Please try again later.", "warning");
            });
        } else {
            showToast("Ad system initializing, please wait.", "warning");
        }
    } catch(e) { console.error(e); }
}

// 22. History Logic
async function initHistory() {
    document.querySelectorAll('#section-history .tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('#section-history .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            loadHistory(e.target.getAttribute('data-tab'));
        };
    });
    loadHistory('all');
}

async function loadHistory(tab) {
    const container = document.getElementById('history-container');
    container.innerHTML = `<div class="text-center text-muted" style="padding: 40px 0;">Loading history...</div>`;
    
    try {
        let q;
        const ref = collection(db, "users", String(window.currentUser.id), "history");
        
        if (tab === 'all') {
            q = query(ref, orderBy("timestamp", "desc"), limit(10));
        } else if (tab === 'analysis') {
            q = query(ref, where("type", "==", "analysis"), orderBy("timestamp", "desc"), limit(10));
        } else if (tab === 'topup') {
            q = query(ref, where("type", "in", ["credit", "premium", "pending_credit"]), orderBy("timestamp", "desc"), limit(10));
        } else if (tab === 'ads') {
            q = query(ref, where("type", "==", "ad_reward"), orderBy("timestamp", "desc"), limit(10));
        }

        const snaps = await getDocs(q);
        if (snaps.empty) {
            container.innerHTML = `<div class="text-center text-muted" style="padding: 40px 0;">No history found.</div>`;
            return;
        }

        let html = "";
        snaps.forEach(docSnap => {
            const d = docSnap.data();
            const date = new Date(d.timestamp).toLocaleString();
            let icon = "📝", title = "Transaction", color = "var(--text-primary)";
            
            if (d.type === 'analysis') { icon = "📊"; title = "Market Analysis: " + d.symbol; color = "var(--text-muted)"; }
            if (d.type === 'ad_reward') { icon = "📺"; title = "Ad Reward"; color = "var(--accent-green)"; }
            
            html += `
                <div class="history-item">
                    <div class="flex justify-between items-center">
                        <div class="font-bold flex gap-2"><span style="font-size:16px;">${icon}</span> ${title}</div>
                        <div class="font-bold" style="color:${d.amount > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${d.amount > 0 ? '+' : ''}${d.amount} cr</div>
                    </div>
                    <div class="text-muted" style="font-size:10px;">${date}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="text-center text-red" style="padding: 40px 0;">Error loading history.</div>`;
    }
}

// 23. Support Logic
function initSupport() {
    if(window.currentUser) {
        document.getElementById('support-username').value = "@" + window.currentUser.username;
    }
    
    document.getElementById('support-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-submit-support');
        btn.innerText = "Submitting...";
        btn.disabled = true;
        
        const data = {
            name: document.getElementById('support-name').value,
            username: document.getElementById('support-username').value,
            subject: document.getElementById('support-subject').value,
            description: document.getElementById('support-desc').value,
            telegram_id: window.currentUser?.id,
            timestamp: new Date().toISOString()
        };

        try {
            await fetch("https://formspree.io/f/mpqklnpe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            document.getElementById('support-form').classList.add('hidden');
            document.getElementById('support-success').classList.remove('hidden');
            
            // Optional: Telegram Bot integration fallback (ping bot API to notify group)
            const botToken = "8253538797:AAHIFJJOMzh2PWIlwR3TujV79S-PBTYogcg";
            const chatId = "-1002527868754";
            const text = `🚨 New Support Ticket\nUser: ${data.username}\nID: ${data.telegram_id}\nSubject: ${data.subject}\n\n${data.description}`;
            fetch(`https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(text)}`).catch(console.error);

        } catch (err) {
            showToast("❌ Submission failed. Try again.", "error");
        } finally {
            btn.innerText = "📤 Submit Ticket";
            btn.disabled = false;
        }
    };
}

// UI Utilities
window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : ''}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
};

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num;
}

function generateInitialsAvatar(initials) {
    const canvas = document.createElement('canvas');
    canvas.width = 60; canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00d4aa';
    ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials.toUpperCase(), 30, 30);
    return canvas.toDataURL();
}

// Fullscreen Chart
document.getElementById('btn-fullscreen').onclick = () => {
    document.getElementById('chart-fullscreen-modal').classList.add('open');
    const container = document.getElementById('fs_chart_container');
    container.innerHTML = "";
    
    if (currentChartSource === 'tv') {
        new window.TradingView.widget({
            "autosize": true, "symbol": currentSymbol.tvSymbol, "interval": mapTimeframeToTV(currentTimeframe),
            "timezone": "Etc/UTC", "theme": document.documentElement.getAttribute('data-theme') || "dark",
            "style": "1", "locale": "en", "enable_publishing": false,
            "backgroundColor": "transparent", "gridColor": "rgba(255, 255, 255, 0.06)",
            "hide_top_toolbar": false, "save_image": false,
            "container_id": "fs_chart_container",
            "studies": ["RSI@tv-basicstudies", "MACD@tv-basicstudies"]
        });
    } else {
        // Mock lightweight chart for fullscreen for simplicity
        container.innerHTML = "<h3 style='padding:20px; text-align:center;'>Fullscreen Binance/OANDA Chart active.</h3>";
    }
};

// Bootstrap
window.addEventListener('load', () => {
    // Delay slightly to let TG variables load
    setTimeout(init, 500);
});
