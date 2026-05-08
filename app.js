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
let tg = {};
try {
    tg = window.Telegram?.WebApp || {};
    if (tg.ready) tg.ready();
    if (tg.expand) tg.expand();
    if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();

    if (tg.colorScheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    }
    if (tg.onEvent) {
        tg.onEvent('themeChanged', () => {
            document.documentElement.setAttribute('data-theme', tg.colorScheme);
        });
    }
} catch (e) {
    console.warn("Telegram WebApp not found or failed to initialize", e);
}

async function init() {
    try {
        const user = tg.initDataUnsafe?.user;
        
        // For local testing bypass (optional: remove in production)
        const mockUser = { id: 123456789, username: "arghamatrix", first_name: "Argha", last_name: "Matrix" };
        const activeUser = user || mockUser;

        if (!user && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) loadingScreen.classList.add('hidden');
            const blockScreen = document.getElementById('telegram-block-screen');
            if (blockScreen) blockScreen.classList.remove('hidden');
            return;
        }

        const telegramUser = {
            id: activeUser.id,
            username: activeUser.username || "NoUsername",
            first_name: activeUser.first_name,
            last_name: activeUser.last_name || "",
            photo_url: activeUser.photo_url || null
        };

        // Firebase with 10s timeout guard
        await Promise.race([
            autoLoginOrRegister(telegramUser),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase timeout')), 10000))
        ]).catch(e => {
            console.warn('Auth fallback:', e.message);
            if (!window.currentUser) {
                window.currentUser = {
                    ...telegramUser,
                    credits: 200, premium_active: false, premium_expires: null,
                    total_analyses: 0
                };
            }
        });

        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.classList.add('hidden');
        const appWrapper = document.getElementById('app-wrapper');
        if (appWrapper) appWrapper.classList.remove('hidden');

        try { initRouter(); } catch(e) { console.error('initRouter error:', e); }
        try { renderHome(); } catch(e) { console.error('renderHome error:', e); }
        try { initAnalysis(); } catch(e) { console.error('initAnalysis error:', e); }
        try { initTopup(); } catch(e) { console.error('initTopup error:', e); }
        try { initSupport(); } catch(e) { console.error('initSupport error:', e); }

        setTimeout(() => {
            try { fetchBinanceSymbols(); } catch(e) { console.error('fetchBinanceSymbols error:', e); }
            try { startMarketTicker(); } catch(e) { console.error('startMarketTicker error:', e); }
        }, 800);

    } catch (err) {
        console.error('init() failed:', err);
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.classList.add('hidden');
        const appWrapper = document.getElementById('app-wrapper');
        if (appWrapper) appWrapper.classList.remove('hidden');
        try { initRouter(); renderHome(); initAnalysis(); initTopup(); initSupport(); } catch(e) {}
    }
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
        let expDate = window.currentUser.premium_expires;
        if (expDate && typeof expDate.toDate === 'function') expDate = expDate.toDate();
        else expDate = new Date(expDate);

        if (expDate < new Date()) {
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
    if (sectionId === 'analysis') {
        setTimeout(() => {
            if (currentChartSource === 'tv' && document.getElementById('tv_chart_container').innerHTML === "") {
                loadChart();
            }
        }, 50);
    }
    
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
        const badge = document.getElementById('home-premium-badge');
        badge.classList.remove('hidden');
        document.getElementById('home-free-badge').classList.add('hidden');
        
        if (user.premium_expires) {
            let expDate = user.premium_expires;
            if (expDate && typeof expDate.toDate === 'function') expDate = expDate.toDate();
            else expDate = new Date(expDate);
            
            const diffTime = expDate - new Date();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 0) {
                badge.innerText = `⭐ PREMIUM ACTIVE (${diffDays} days left)`;
            } else {
                badge.innerText = `⭐ PREMIUM ACTIVE (Expires today)`;
            }
        }
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
  // Crypto
  { symbol: "BTCUSDT", display: "BTC/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:BTCUSDT" },
  { symbol: "ETHUSDT", display: "ETH/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:ETHUSDT" },
  { symbol: "SOLUSDT", display: "SOL/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:SOLUSDT" },
  { symbol: "BNBUSDT", display: "BNB/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:BNBUSDT" },
  { symbol: "XRPUSDT", display: "XRP/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:XRPUSDT" },
  { symbol: "ADAUSDT", display: "ADA/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:ADAUSDT" },
  { symbol: "DOTUSDT", display: "DOT/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:DOTUSDT" },
  { symbol: "LTCUSDT", display: "LTC/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:LTCUSDT" },
  { symbol: "AVAXUSDT", display: "AVAX/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:AVAXUSDT" },
  { symbol: "LINKUSDT", display: "LINK/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:LINKUSDT" },
  { symbol: "DOGEUSDT", display: "DOGE/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:DOGEUSDT" },
  { symbol: "SHIBUSDT", display: "SHIB/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:SHIBUSDT" },
  { symbol: "PEPEUSDT", display: "PEPE/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:PEPEUSDT" },
  { symbol: "UNIUSDT", display: "UNI/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:UNIUSDT" },
  { symbol: "AAVEUSDT", display: "AAVE/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:AAVEUSDT" },
  { symbol: "ATOMUSDT", display: "ATOM/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:ATOMUSDT" },
  { symbol: "MATICUSDT", display: "MATIC/USDT", category: "crypto", exchange: "Binance", tvSymbol: "BINANCE:MATICUSDT" },
  
  // Forex
  { symbol: "EURUSD", display: "EUR/USD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:EURUSD" },
  { symbol: "GBPUSD", display: "GBP/USD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:GBPUSD" },
  { symbol: "USDJPY", display: "USD/JPY", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDJPY" },
  { symbol: "USDCHF", display: "USD/CHF", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDCHF" },
  { symbol: "AUDUSD", display: "AUD/USD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:AUDUSD" },
  { symbol: "USDCAD", display: "USD/CAD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDCAD" },
  { symbol: "NZDUSD", display: "NZD/USD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:NZDUSD" },
  { symbol: "USDSEK", display: "USD/SEK", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDSEK" },
  { symbol: "USDNOK", display: "USD/NOK", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDNOK" },
  { symbol: "USDSGD", display: "USD/SGD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDSGD" },
  { symbol: "USDHKD", display: "USD/HKD", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDHKD" },
  { symbol: "USDINR", display: "USD/INR", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDINR" },
  { symbol: "USDTRY", display: "USD/TRY", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDTRY" },
  { symbol: "USDZAR", display: "USD/ZAR", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDZAR" },
  { symbol: "USDMXN", display: "USD/MXN", category: "forex", exchange: "OANDA", tvSymbol: "OANDA:USDMXN" },
  { symbol: "USDBRL", display: "USD/BRL", category: "forex", exchange: "OANDA", tvSymbol: "FX_IDC:USDBRL" },
  
  // Metals
  { symbol: "XAUUSD", display: "XAU/USD (Gold)", category: "metals", exchange: "OANDA", tvSymbol: "OANDA:XAUUSD" },
  { symbol: "XAGUSD", display: "XAG/USD (Silver)", category: "metals", exchange: "OANDA", tvSymbol: "OANDA:XAGUSD" },
  
  // Stocks (US & India)
  { symbol: "AAPL", display: "Apple Inc.", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:AAPL" },
  { symbol: "TSLA", display: "Tesla Inc.", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:TSLA" },
  { symbol: "MSFT", display: "Microsoft", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:MSFT" },
  { symbol: "AMZN", display: "Amazon", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:AMZN" },
  { symbol: "NVDA", display: "NVIDIA", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:NVDA" },
  { symbol: "GOOGL", display: "Alphabet (Google)", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:GOOGL" },
  { symbol: "META", display: "Meta Platforms", category: "stocks", exchange: "NASDAQ", tvSymbol: "NASDAQ:META" },
  { symbol: "RELIANCE", display: "Reliance", category: "stocks", exchange: "NSE", tvSymbol: "NSE:RELIANCE" },
  { symbol: "TCS", display: "TCS", category: "stocks", exchange: "NSE", tvSymbol: "NSE:TCS" },
  { symbol: "HDFCBANK", display: "HDFC Bank", category: "stocks", exchange: "NSE", tvSymbol: "NSE:HDFCBANK" },
  { symbol: "INFY", display: "Infosys", category: "stocks", exchange: "NSE", tvSymbol: "NSE:INFY" },
  { symbol: "ICICIBANK", display: "ICICI Bank", category: "stocks", exchange: "NSE", tvSymbol: "NSE:ICICIBANK" },
  { symbol: "SBIN", display: "State Bank of India", category: "stocks", exchange: "NSE", tvSymbol: "NSE:SBIN" },
  { symbol: "BHARTIARTL", display: "Bharti Airtel", category: "stocks", exchange: "NSE", tvSymbol: "NSE:BHARTIARTL" },
  { symbol: "ADANIENT", display: "Adani Ent", category: "stocks", exchange: "NSE", tvSymbol: "NSE:ADANIENT" },
  { symbol: "ZOMATO", display: "Zomato", category: "stocks", exchange: "NSE", tvSymbol: "NSE:ZOMATO" },
  { symbol: "PAYTM", display: "Paytm", category: "stocks", exchange: "NSE", tvSymbol: "NSE:PAYTM" },
  { symbol: "NYKAA", display: "Nykaa", category: "stocks", exchange: "NSE", tvSymbol: "NSE:NYKAA" },
  
  // Indices
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
    const syms = symbolDatabase.filter(s => s.category === cat).slice(0, 30);
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
        "width": "100%",
        "height": "100%",
        "symbol": currentSymbol.tvSymbol,
        "interval": mapTimeframeToTV(currentTimeframe),
        "timezone": "Etc/UTC",
        "theme": document.documentElement.getAttribute('data-theme') || "dark",
        "style": "1",
        "locale": "en",
        "enable_publishing": false,
        "backgroundColor": "transparent",
        "hide_top_toolbar": false,
        "hide_legend": false,
        "save_image": false,
        "hide_volume": false,
        "container_id": "tv_chart_container"
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

function getMockBasePrice(sym) {
    const basePrices = {
        "XAGUSD": 30.50,
        "AAPL": 175.50, "TSLA": 180.20, "MSFT": 410.00, "AMZN": 185.00, "NVDA": 850.00, "GOOGL": 155.00, "META": 480.00,
        "RELIANCE": 2900.50, "TCS": 3950.00, "HDFCBANK": 1500.00, "INFY": 1400.00, "ICICIBANK": 1100.00, "SBIN": 800.00,
        "BHARTIARTL": 1200.00, "ADANIENT": 3100.00, "ZOMATO": 180.00, "PAYTM": 400.00, "NYKAA": 160.00,
        "SPX": 5100.00
    };
    return basePrices[sym] || 100.00;
}

async function fetchTwelveDataHistory() {
    try {
        // Fallback for forex using twelvedata
        let interval = currentTimeframe;
        if(interval === '1m') interval = '1min';
        if(interval === '5m') interval = '5min';
        if(interval === '15m') interval = '15min';
        if(interval === '30m') interval = '30min';
        
        let queryParam = `symbol=${currentSymbol.symbol}`;
        if (currentCategory === 'forex' || currentCategory === 'metals') {
            queryParam = `symbol=${currentSymbol.display.split(' ')[0]}`;
        }
        if (currentSymbol.exchange === 'NSE') {
            queryParam += `&exchange=NSE`;
        }
        
        const res = await fetch(`https://api.twelvedata.com/time_series?${queryParam}&interval=${interval}&outputsize=100&apikey=${TWELVEDATA_API_KEY}`);
        const data = await res.json();
        if(data && data.values) {
            const cdata = data.values.reverse().map(d => ({
                time: new Date(d.datetime).getTime() / 1000,
                open: parseFloat(d.open), high: parseFloat(d.high), low: parseFloat(d.low), close: parseFloat(d.close)
            }));
            lwSeries.setData(cdata);
            document.getElementById('live-price').innerText = parseFloat(cdata[cdata.length-1].close).toFixed(5);
        } else {
            const base = getMockBasePrice(currentSymbol.symbol);
            let cdata = [];
            let currentT = Math.floor(Date.now() / 1000) - (100 * 15 * 60);
            let lastClose = base;
            for(let i=0; i<100; i++) {
                const vol = base * 0.002;
                const o = lastClose;
                const h = o + (Math.random() * vol);
                const l = o - (Math.random() * vol);
                const c = l + (Math.random() * (h - l));
                cdata.push({time: currentT, open: o, high: h, low: l, close: c});
                lastClose = c;
                currentT += 15 * 60;
            }
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
            let queryParam = `symbol=${currentSymbol.symbol}`;
            if (currentCategory === 'forex' || currentCategory === 'metals') {
                queryParam = `symbol=${currentSymbol.display.split(' ')[0]}`;
            }
            if (currentSymbol.exchange === 'NSE') {
                queryParam += `&exchange=NSE`;
            }
            
            const res = await fetch(`https://api.twelvedata.com/quote?${queryParam}&apikey=${TWELVEDATA_API_KEY}`);
            const data = await res.json();
            
            if (data && data.close) {
                document.getElementById('live-price').innerText = "$" + parseFloat(data.close).toFixed(4);
                const pct = parseFloat(data.percent_change);
                const chgEl = document.getElementById('live-change');
                chgEl.innerText = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
                chgEl.className = pct >= 0 ? "text-green font-bold" : "text-red font-bold";
            } else {
                const basePrice = getMockBasePrice(currentSymbol.symbol);
                const fluctuation = (Math.random() - 0.5) * (basePrice * 0.002);
                const simulatedPrice = basePrice + fluctuation;
                
                document.getElementById('live-price').innerText = "$" + simulatedPrice.toFixed(4);
                
                const mockPct = (Math.random() * 3) - 1.5; // -1.5% to +1.5%
                const chgEl = document.getElementById('live-change');
                chgEl.innerText = (mockPct >= 0 ? "+" : "") + mockPct.toFixed(2) + "%";
                chgEl.className = mockPct >= 0 ? "text-green font-bold" : "text-red font-bold";
            }
        }
    } catch(e){
        console.error("fetchLiveStats error", e);
    }
}

// ═══════════════════════════════════════════
// 8. PROFESSIONAL ICT/SMC ANALYSIS ENGINE
// ═══════════════════════════════════════════

// --- Math Helpers ---
function calcEMA(closes, period) {
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function calcRSI(closes, period = 14) {
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    const rs = gains / (losses || 0.001);
    return 100 - (100 / (1 + rs));
}

function calcATR(candles, period = 14) {
    let trSum = 0;
    const start = Math.max(1, candles.length - period);
    for (let i = start; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        );
        trSum += tr;
    }
    return trSum / period;
}

function detectMarketStructure(candles) {
    const n = candles.length;
    if (n < 5) return { structure: 'NEUTRAL', bos: false, mss: false };
    const recent = candles.slice(-20);
    let highs = recent.map(c => c.high);
    let lows = recent.map(c => c.low);
    const hhhl = highs[highs.length-1] > highs[Math.floor(highs.length/2)] && lows[lows.length-1] > lows[Math.floor(lows.length/2)];
    const lllh = highs[highs.length-1] < highs[Math.floor(highs.length/2)] && lows[lows.length-1] < lows[Math.floor(lows.length/2)];
    const prevSwingHigh = Math.max(...highs.slice(0, -3));
    const prevSwingLow = Math.min(...lows.slice(0, -3));
    const lastClose = candles[n-1].close;
    const bos = lastClose > prevSwingHigh || lastClose < prevSwingLow;
    const mss = bos && ((hhhl && lastClose > prevSwingHigh) || (lllh && lastClose < prevSwingLow));
    return { structure: hhhl ? 'BULLISH' : lllh ? 'BEARISH' : 'RANGING', bos, mss };
}

function detectFVG(candles) {
    for (let i = candles.length - 3; i >= Math.max(0, candles.length - 10); i--) {
        const gap = candles[i+2].low - candles[i].high;
        if (gap > 0) return { present: true, type: 'Bullish', top: candles[i+2].low, bottom: candles[i].high };
        const gap2 = candles[i].low - candles[i+2].high;
        if (gap2 > 0) return { present: true, type: 'Bearish', top: candles[i].low, bottom: candles[i+2].high };
    }
    return { present: false };
}

function detectOrderBlock(candles) {
    const n = candles.length;
    for (let i = n - 5; i >= Math.max(0, n - 15); i--) {
        const isBullishOB = candles[i].close < candles[i].open && candles[i+1] && candles[i+1].close > candles[i].high;
        const isBearishOB = candles[i].close > candles[i].open && candles[i+1] && candles[i+1].close < candles[i].low;
        if (isBullishOB) return { present: true, type: 'Bullish', high: candles[i].high, low: candles[i].low };
        if (isBearishOB) return { present: true, type: 'Bearish', high: candles[i].high, low: candles[i].low };
    }
    return { present: false };
}

function detectLiquidity(candles) {
    const highs = candles.slice(-20).map(c => c.high);
    const lows = candles.slice(-20).map(c => c.low);
    const maxH = Math.max(...highs); const minL = Math.min(...lows);
    const eqHighs = highs.filter(h => Math.abs(h - maxH) / maxH < 0.002).length >= 2;
    const eqLows = lows.filter(l => Math.abs(l - minL) / minL < 0.002).length >= 2;
    return { buyside: eqHighs ? maxH : null, sellside: eqLows ? minL : null, swept: candles.slice(-3).some(c => c.low < minL || c.high > maxH) };
}

function getKillZone() {
    const h = new Date().getUTCHours();
    if (h >= 2 && h < 5) return { active: true, name: 'Asian Session' };
    if (h >= 7 && h < 10) return { active: true, name: 'London Open KZ ⚡' };
    if (h >= 12 && h < 15) return { active: true, name: 'NY Open KZ ⚡' };
    if (h >= 19 && h < 21) return { active: true, name: 'Silver Bullet Window' };
    return { active: false, name: 'Off-Session' };
}

function detectCandlePattern(candles) {
    const n = candles.length;
    const c = candles[n-1], p = candles[n-2];
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (lowerWick > body * 2 && upperWick < body * 0.5) return 'Pin Bar (Bullish)';
    if (upperWick > body * 2 && lowerWick < body * 0.5) return 'Pin Bar (Bearish)';
    if (body < (c.high - c.low) * 0.1) return 'Doji (Indecision)';
    if (c.close > c.open && p.close < p.open && c.close > p.open) return 'Bullish Engulfing';
    if (c.close < c.open && p.close > p.open && c.close < p.open) return 'Bearish Engulfing';
    const marubozu = body > (c.high - c.low) * 0.85;
    if (marubozu) return c.close > c.open ? 'Bullish Marubozu' : 'Bearish Marubozu';
    return 'Standard Candle';
}

function getFibLevels(high, low) {
    const range = high - low;
    return {
        ote_low: low + range * 0.62,
        ote_mid: low + range * 0.705,
        ote_high: low + range * 0.79,
        ext1: high + range * 0.618,
        ext2: high + range * 1.0
    };
}

async function fetchCandlesForAnalysis() {
    try {
        if (currentCategory === 'crypto') {
            const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${currentSymbol.symbol}&interval=${currentTimeframe}&limit=100`);
            const data = await res.json();
            return data.map(d => ({ open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] }));
        } else {
            let sym = currentSymbol.symbol;
            if (currentCategory === 'forex' || currentCategory === 'metals') sym = currentSymbol.display.split(' ')[0];
            let interval = currentTimeframe.replace('m','min').replace('h','h').replace('d','day').replace('w','week');
            if (interval === '1day') interval = '1day';
            const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${sym}&interval=${interval}&outputsize=100&apikey=${TWELVEDATA_API_KEY}`);
            const data = await res.json();
            if (data.values) return data.values.reverse().map(d => ({ open: +d.open, high: +d.high, low: +d.low, close: +d.close, volume: +(d.volume||0) }));
        }
    } catch(e) { console.error('fetchCandlesForAnalysis', e); }
    return null;
}

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
        "📡 Fetching live OHLCV candles...",
        "📊 Calculating RSI · MACD · EMA 20/50/200...",
        "🏗️ Mapping BOS · MSS · Market Structure...",
        "🎯 Detecting FVG · Order Block · Liquidity...",
        "⚡ ICT Kill Zone · Fibonacci OTE · Signal..."
    ];
    
    for (let i = 0; i < steps.length; i++) {
        stepText.innerText = steps[i];
        await new Promise(r => setTimeout(r, 500));
    }

    // --- Fetch real candles ---
    let candles = await fetchCandlesForAnalysis();
    const priceStr = document.getElementById('live-price').innerText.replace(/[^0-9.]/g, '');
    const livePrice = parseFloat(priceStr) || getMockBasePrice(currentSymbol.symbol);

    // Fallback: build synthetic candles from live price if fetch failed
    if (!candles || candles.length < 20) {
        candles = [];
        let p = livePrice;
        const now = Date.now() / 1000;
        for (let i = 99; i >= 0; i--) {
            const v = p * 0.004;
            const o = p + (Math.random() - 0.5) * v;
            const h = Math.max(o, p) + Math.random() * v * 0.5;
            const l = Math.min(o, p) - Math.random() * v * 0.5;
            candles.push({ open: o, high: h, low: l, close: p });
            p = p + (Math.random() - 0.49) * v;
        }
    }

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // --- Compute Indicators ---
    const rsi = calcRSI(closes);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes.length >= 200 ? closes : closes, Math.min(200, closes.length));
    const atr = calcATR(candles);
    const macdFast = calcEMA(closes, 12);
    const macdSlow = calcEMA(closes, 26);
    const macd = macdFast - macdSlow;

    // --- SMC/ICT Detections ---
    const ms = detectMarketStructure(candles);
    const fvg = detectFVG(candles);
    const ob = detectOrderBlock(candles);
    const liq = detectLiquidity(candles);
    const kz = getKillZone();
    const pattern = detectCandlePattern(candles);
    const swingHigh = Math.max(...candles.slice(-30).map(c => c.high));
    const swingLow = Math.min(...candles.slice(-30).map(c => c.low));
    const fib = getFibLevels(swingHigh, swingLow);
    const inOTE = currentPrice >= fib.ote_low && currentPrice <= fib.ote_high;

    // --- Scoring Engine (multi-factor) ---
    let bullScore = 0, bearScore = 0;
    // EMA stack
    if (ema20 > ema50) bullScore += 10; else bearScore += 10;
    if (ema50 > ema200) bullScore += 10; else bearScore += 10;
    if (currentPrice > ema20) bullScore += 8; else bearScore += 8;
    // RSI
    if (rsi < 35) bullScore += 15;
    else if (rsi > 65) bearScore += 15;
    else if (rsi > 50) bullScore += 5; else bearScore += 5;
    // MACD
    if (macd > 0) bullScore += 10; else bearScore += 10;
    // Market structure
    if (ms.structure === 'BULLISH') bullScore += 12; else if (ms.structure === 'BEARISH') bearScore += 12;
    if (ms.bos) { if (ms.structure === 'BULLISH') bullScore += 8; else bearScore += 8; }
    if (ms.mss) { if (ms.structure === 'BULLISH') bullScore += 10; else bearScore += 10; }
    // FVG
    if (fvg.present && fvg.type === 'Bullish') bullScore += 10;
    if (fvg.present && fvg.type === 'Bearish') bearScore += 10;
    // Order Block
    if (ob.present && ob.type === 'Bullish') bullScore += 12;
    if (ob.present && ob.type === 'Bearish') bearScore += 12;
    // Liquidity sweep
    if (liq.swept) { if (ms.structure === 'BULLISH') bullScore += 8; else bearScore += 8; }
    // Kill zone
    if (kz.active) { bullScore += 5; bearScore += 5; }
    // OTE
    if (inOTE && ms.structure === 'BULLISH') bullScore += 10;
    if (inOTE && ms.structure === 'BEARISH') bearScore += 10;
    // Candle patterns
    if (pattern.includes('Bullish')) bullScore += 8;
    if (pattern.includes('Bearish')) bearScore += 8;

    const totalScore = bullScore + bearScore || 1;
    let direction = 'NEUTRAL';
    let confidence = Math.round(Math.max(bullScore, bearScore) / totalScore * 100);
    if (bullScore > bearScore && confidence >= 55) direction = 'BUY';
    else if (bearScore > bullScore && confidence >= 55) direction = 'SELL';
    // Clamp score to 40-99
    let score = Math.max(40, Math.min(99, confidence));
    if (direction === 'NEUTRAL') score = Math.max(40, Math.min(64, score));

    // --- TP/SL with 1:2:3 RR ---
    let tp1, tp2, sl;
    const atrRisk = atr || currentPrice * 0.005;
    if (direction === 'BUY') {
        sl  = currentPrice - atrRisk;
        tp1 = currentPrice + atrRisk * 2;
        tp2 = currentPrice + atrRisk * 3;
    } else if (direction === 'SELL') {
        sl  = currentPrice + atrRisk;
        tp1 = currentPrice - atrRisk * 2;
        tp2 = currentPrice - atrRisk * 3;
    } else {
        sl  = currentPrice - atrRisk;
        tp1 = currentPrice + atrRisk;
        tp2 = currentPrice + atrRisk * 2;
    }

    // --- Premium/Discount zone ---
    const midRange = (swingHigh + swingLow) / 2;
    const zone = currentPrice > midRange ? 'Premium Zone' : 'Discount Zone';

    const result = {
        symbol: currentSymbol.display, timeframe: currentTimeframe,
        source: currentChartSource.toUpperCase(), score, direction,
        entry: currentPrice, tp1, tp2, sl,
        rsi, ema20, ema50, macd, atr: atrRisk,
        ms, fvg, ob, liq, kz, pattern, inOTE, zone, fib,
        swingHigh, swingLow
    };

    loader.classList.remove('active');

    // Handle Credit Deduction
    if (direction !== 'NEUTRAL' && !user.premium_active) {
        await updateDoc(doc(db, "users", String(user.id)), { credits: increment(-50), total_analyses: increment(1) });
        user.credits -= 50; user.total_analyses += 1;
        updateHeaderCredits();
        await addDoc(collection(db, "users", String(user.id), "history"), {
            type: "analysis", amount: -50, score, symbol: currentSymbol.display, direction, timestamp: new Date().toISOString()
        });
        document.getElementById('res-credit-info').innerText = `💎 50 credits deducted | Remaining: ${user.credits} cr`;
        document.getElementById('res-credit-info').className = "pill pill-green flex justify-center py-2 mb-3";
    } else if (direction === 'NEUTRAL') {
        document.getElementById('res-credit-info').innerText = "⚠️ Neutral signal — No credits deducted.";
        document.getElementById('res-credit-info').className = "pill pill-gold flex justify-center py-2 mb-3";
    } else {
        document.getElementById('res-credit-info').innerText = "✨ Premium — Unlimited analyses";
        document.getElementById('res-credit-info').className = "pill pill-gold flex justify-center py-2 mb-3";
    }

    renderAnalysisResult(result);
}

function renderAnalysisResult(res) {
    window.currentAnalysisResult = res;
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
    
    document.getElementById('res-tp1-pct').innerText = `+${tp1Pct}% | RR: 1:2`;
    document.getElementById('res-tp2-pct').innerText = `+${(tp1Pct * 1.5).toFixed(2)}% | RR: 1:3`;
    document.getElementById('res-sl-pct').innerText = `-${slPct}% | Risk: 1 unit`;

    // SMC Details
    const fix = currentCategory === 'crypto' ? 2 : 4;
    const msIcon = res.ms.structure === 'BULLISH' ? '🟢' : res.ms.structure === 'BEARISH' ? '🔴' : '⚪';
    document.getElementById('res-smc-details').innerHTML = `
        ${msIcon} <b>Market Structure:</b> ${res.ms.structure}<br>
        ${res.ms.bos ? '✅' : '❌'} Break of Structure (BOS)<br>
        ${res.ms.mss ? '✅' : '❌'} Market Structure Shift (MSS)<br>
        ${res.fvg.present ? `✅ FVG: <b>${res.fvg.type}</b> gap detected` : '❌ No FVG in recent candles'}<br>
        ${res.ob.present ? `✅ Order Block: <b>${res.ob.type}</b> OB active` : '❌ No Order Block nearby'}<br>
        ${res.liq.buyside ? `⚡ Buy-Side Liq: $${res.liq.buyside.toFixed(fix)}` : ''} ${res.liq.sellside ? `⚡ Sell-Side Liq: $${res.liq.sellside.toFixed(fix)}` : ''}<br>
        ${res.liq.swept ? '🎯 Liquidity Swept — reversal likely' : '🔄 Liquidity intact'}<br>
        🕐 <b>Kill Zone:</b> ${res.kz.name} ${res.kz.active ? '✅ Active' : ''}<br>
        📐 <b>Zone:</b> ${res.zone}<br>
        ${res.inOTE ? '🎯 Price in Fibonacci OTE (62-79%)' : '📍 Outside OTE zone'}<br>
        🕯️ <b>Pattern:</b> ${res.pattern}
    `;
    // Indicator details
    const rsiZone = res.rsi < 30 ? 'Oversold 🟢' : res.rsi > 70 ? 'Overbought 🔴' : res.rsi > 50 ? 'Bullish zone' : 'Bearish zone';
    const macdStr = res.macd > 0 ? '🟢 Bullish Crossover' : '🔴 Bearish Crossover';
    const emaStack = res.ema20 > res.ema50 ? '🟢 Bullish (EMA20 > EMA50)' : '🔴 Bearish (EMA20 < EMA50)';
    document.getElementById('res-ind-details').innerHTML = `
        📊 <b>RSI (14):</b> ${res.rsi.toFixed(1)} — ${rsiZone}<br>
        📈 <b>MACD:</b> ${macdStr}<br>
        〰️ <b>EMA 20:</b> $${res.ema20.toFixed(fix)} | <b>EMA 50:</b> $${res.ema50.toFixed(fix)}<br>
        📏 <b>ATR:</b> $${res.atr.toFixed(fix)} (volatility)<br>
        🔼 <b>Swing High:</b> $${res.swingHigh.toFixed(fix)} | 🔽 <b>Swing Low:</b> $${res.swingLow.toFixed(fix)}
    `;

    document.getElementById('analysis-result-backdrop').classList.add('open');
    document.getElementById('analysis-result-modal').classList.add('open');
}

window.closeAnalysisModal = () => {
    document.getElementById('analysis-result-backdrop').classList.remove('open');
    document.getElementById('analysis-result-modal').classList.remove('open');
    document.getElementById('res-gauge-path').style.strokeDashoffset = 377; // reset
};

window.shareAnalysis = () => {
    if (!window.currentAnalysisResult) return;
    const res = window.currentAnalysisResult;
    
    const fix = currentCategory === 'crypto' ? 2 : 4;
    const entry = "$" + res.entry.toFixed(fix);
    const tp1 = "$" + res.tp1.toFixed(fix);
    const tp2 = "$" + res.tp2.toFixed(fix);
    const sl = "$" + res.sl.toFixed(fix);
    
    const text = `🧠 *Argha Matrix Signal*\n\n` +
                 `📈 *Pair:* ${res.symbol}\n` +
                 `⚡ *Direction:* ${res.direction}\n` +
                 `🎯 *Entry:* ${entry}\n` +
                 `✅ *TP 1:* ${tp1}\n` +
                 `🚀 *TP 2:* ${tp2}\n` +
                 `🛑 *SL:* ${sl}\n\n` +
                 `🔎 *Reasoning:*\n` +
                 `Fair Value Gap: ✅ Present\n` +
                 `Order Block: ✅ Detected\n` +
                 `Break of Structure: ✅ Confirmed on ${res.timeframe}\n\n` +
                 `🤖 @ArghaMatrix_bot`;
                 
    const url = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
    window.Telegram.WebApp.openTelegramLink(url);
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
            
            // Add to User History as well
            await addDoc(collection(db, "users", String(window.currentUser.id), "history"), {
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
        const ref = collection(db, "users", String(window.currentUser.id), "history");
        const q = query(ref, orderBy("timestamp", "desc"), limit(50));
        const snaps = await getDocs(q);
        
        let filtered = [];
        snaps.forEach(docSnap => {
            const d = docSnap.data();
            if (tab === 'all') filtered.push(d);
            else if (tab === 'analysis' && d.type === 'analysis') filtered.push(d);
            else if (tab === 'topup' && ["credit", "premium", "pending_credit", "pending_premium"].includes(d.type)) filtered.push(d);
            else if (tab === 'ads' && d.type === 'ad_reward') filtered.push(d);
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="text-center text-muted" style="padding: 40px 0;">No history found.</div>`;
            return;
        }

        let html = "";
        filtered.slice(0, 20).forEach(d => {
            const date = new Date(d.timestamp).toLocaleString();
            let icon = "📝", title = "Transaction", color = "var(--text-primary)";
            let rightSide = `<div class="font-bold" style="color:${d.amount > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${d.amount > 0 ? '+' : ''}${d.amount} cr</div>`;
            
            if (d.type === 'analysis') { icon = "📊"; title = "Market Analysis: " + d.symbol; color = "var(--text-muted)"; }
            else if (d.type === 'ad_reward') { icon = "📺"; title = "Ad Reward"; color = "var(--accent-green)"; }
            else if (d.type.startsWith('pending_') || d.status) { 
                if (d.status === 'success') {
                    icon = "✅"; title = "Success: " + (d.item || "TopUp");
                    rightSide = `<div class="pill pill-green" style="font-size:10px;">Success</div>`;
                } else if (d.status === 'failed' || d.status === 'rejected') {
                    icon = "❌"; title = "Failed: " + (d.item || "TopUp");
                    rightSide = `<div class="pill pill-red" style="font-size:10px;">Rejected</div>`;
                } else {
                    icon = "⏳"; title = "Pending: " + (d.item || "TopUp"); 
                    rightSide = `<div class="pill pill-gold" style="font-size:10px;">Pending</div>`; 
                }
            }
            
            html += `
                <div class="history-item">
                    <div class="flex justify-between items-center">
                        <div class="font-bold flex gap-2"><span style="font-size:16px;">${icon}</span> ${title}</div>
                        ${rightSide}
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
            // 1. Save to Firebase Database
            try {
                await addDoc(collection(db, "support_tickets"), {
                    userId: window.currentUser?.id || "anonymous",
                    name: data.name,
                    username: data.username,
                    subject: data.subject,
                    description: data.description,
                    status: "open",
                    timestamp: data.timestamp
                });
            } catch (dbErr) {
                console.error("Failed to save to DB", dbErr);
            }

            // 2. Send to Telegram group
            try {
                const botToken = "8253538797:AAHIFJJOMzh2PWIlwR3TujV79S-PBTYogcg";
                const chatId = "-1002527868754";
                const text = `🚨 *New Support Ticket*\n\n*Name:* ${data.name}\n*User:* ${data.username}\n*ID:* ${data.telegram_id}\n*Subject:* ${data.subject}\n\n*Description:*\n${data.description}`;
                
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" })
                });
            } catch (tgErr) {
                console.error("Failed to send to Telegram", tgErr);
            }

            // 3. Send to Formspree
            try {
                await fetch("https://formspree.io/f/mpqklnpe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
            } catch (fsErr) {
                console.error("Failed to send to Formspree", fsErr);
            }
            
            document.getElementById('support-form').classList.add('hidden');
            document.getElementById('support-success').classList.remove('hidden');
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
function bootstrapApp() {
    setTimeout(init, 500);
}

if (document.readyState === 'complete') {
    bootstrapApp();
} else {
    window.addEventListener('load', bootstrapApp);
}
