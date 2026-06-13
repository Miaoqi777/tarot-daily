/* ============================================================
   weather.js — 天气API获取与显示
   优先：浏览器定位 + Open-Meteo（无需API Key）
   回退1：wttr.in IP定位
   回退2：Open-Meteo 无定位（使用缓存城市坐标）
   ============================================================ */

const WEATHER_CACHE_KEY = 'tarot-weather-cache';
const WEATHER_CITY_KEY = 'tarot-weather-city';
const WEATHER_LAT_KEY = 'tarot-weather-lat';
const WEATHER_LON_KEY = 'tarot-weather-lon';
const CACHE_DURATION = 30 * 60 * 1000;

async function initWeather() {
  const cached = getWeatherCache();
  if (cached) {
    renderWeather(cached);
    return;
  }

  const lastCity = getLastCity();
  if (lastCity) {
    document.getElementById('weather-city').textContent = '📍 ' + lastCity;
  }

  const timeout8s = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000));

  // Try 1: Geolocation + Open-Meteo
  try {
    const data = await Promise.race([fetchByGeolocation(), timeout8s]);
    if (data) { cacheWeather(data); renderWeather(data); return; }
  } catch (e) { console.log('Try1 failed:', e.message); }

  // Try 2: wttr.in
  try {
    const data = await Promise.race([fetchByWttr(), timeout8s]);
    if (data) { cacheWeather(data); renderWeather(data); return; }
  } catch (e) { console.log('Try2 failed:', e.message); }

  // Try 3: Open-Meteo with cached coordinates
  const lat = localStorage.getItem(WEATHER_LAT_KEY);
  const lon = localStorage.getItem(WEATHER_LON_KEY);
  if (lat && lon) {
    try {
      const data = await Promise.race([fetchOpenMeteo(lat, lon), timeout8s]);
      if (data) { cacheWeather(data); renderWeather(data); return; }
    } catch (e) { console.log('Try3 failed:', e.message); }
  }

  // Final fallback
  renderFallbackWeather();
}

// ---------- Cache ----------
function getWeatherCache() {
  try {
    const c = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY));
    if (c && Date.now() - c.timestamp < CACHE_DURATION) return c.data;
  } catch (e) {}
  return null;
}
function cacheWeather(data) {
  localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
}
function getLastCity() { return localStorage.getItem(WEATHER_CITY_KEY) || ''; }
function saveCity(city) { localStorage.setItem(WEATHER_CITY_KEY, city); }

// ---------- Try 1: Geolocation + Open-Meteo ----------
function fetchByGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude.toFixed(4);
        const lon = pos.coords.longitude.toFixed(4);
        localStorage.setItem(WEATHER_LAT_KEY, lat);
        localStorage.setItem(WEATHER_LON_KEY, lon);
        try {
          const w = await fetchOpenMeteo(lat, lon);
          // Try to get Chinese city name
          let city = '当前位置';
          try {
            const geoRes = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=zh`,
              { signal: AbortSignal.timeout(4000) }
            );
            const geoJson = await geoRes.json();
            if (geoJson.address) {
              city = geoJson.address.city || geoJson.address.town ||
                     geoJson.address.county || geoJson.address.state || '当前位置';
            }
          } catch (e) {}
          saveCity(city);
          resolve({ ...w, city });
        } catch (e) { reject(e); }
      },
      (err) => reject(err),
      { timeout: 8000, enableHighAccuracy: false }
    );
  });
}

// ---------- Try 2: wttr.in ----------
async function fetchByWttr() {
  const res = await fetch('https://wttr.in/?format=j1', { signal: AbortSignal.timeout(8000) });
  const json = await res.json();
  const cur = json.current_condition[0];
  const area = json.nearest_area[0];
  const city = area.areaName[0].value || '未知城市';
  saveCity(city);
  const code = Number(cur.weatherCode);
  return {
    city,
    temp: Math.round(Number(cur.temp_C)),
    icon: weatherEmoji(code),
    desc: weatherDesc(code),
    humidity: cur.humidity
  };
}

// ---------- Try 3: Direct Open-Meteo with coords ----------
async function fetchOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const json = await res.json();
  if (!json.current_weather) throw new Error('No weather data');
  const w = json.current_weather;
  const code = Number(w.weathercode);
  return {
    city: getLastCity() || '当前位置',
    temp: Math.round(Number(w.temperature)),
    icon: weatherEmoji(code),
    desc: weatherDesc(code),
    wind: w.windspeed
  };
}

// ---------- Weather Code Mapping (WMO 4680) ----------
function weatherEmoji(code) {
  const c = Number(code);
  if (c === 0) return '☀️';
  if (c === 1) return '🌤️';
  if (c === 2) return '⛅';
  if (c === 3) return '☁️';
  if (c >= 45 && c <= 48) return '🌫️';
  if (c >= 51 && c <= 57) return '🌦️';
  if (c >= 61 && c <= 67) return '🌧️';
  if (c >= 71 && c <= 77) return '🌨️';
  if (c >= 80 && c <= 82) return '🌦️';
  if (c >= 85 && c <= 86) return '🌨️';
  if (c >= 95 && c <= 99) return '⛈️';
  return '🌤️';
}

function weatherDesc(code) {
  const c = Number(code);
  // WMO 4680 weather codes — comprehensive mapping
  if (c === 0)  return '晴朗';
  if (c === 1)  return '大部晴朗';
  if (c === 2)  return '多云';
  if (c === 3)  return '阴天';
  if (c === 45) return '有雾';
  if (c === 48) return '霜雾';
  if (c === 51) return '小毛毛雨';
  if (c === 53) return '毛毛雨';
  if (c === 55) return '大毛毛雨';
  if (c === 56) return '冻毛毛雨';
  if (c === 57) return '大冻毛毛雨';
  if (c === 61) return '小雨';
  if (c === 63) return '中雨';
  if (c === 65) return '大雨';
  if (c === 66) return '冻雨';
  if (c === 67) return '大冻雨';
  if (c === 71) return '小雪';
  if (c === 73) return '中雪';
  if (c === 75) return '大雪';
  if (c === 77) return '雪粒';
  if (c === 80) return '阵雨';
  if (c === 81) return '中阵雨';
  if (c === 82) return '大阵雨';
  if (c === 85) return '小阵雪';
  if (c === 86) return '大阵雪';
  if (c === 95) return '雷暴';
  if (c === 96) return '冰雹雷暴';
  if (c === 99) return '强冰雹雷暴';
  // Fallback: describe by range
  if (c < 50) return '多云';
  if (c < 60) return '毛毛雨';
  if (c < 70) return '有雨';
  if (c < 80) return '有雪';
  if (c < 90) return '阵雨';
  if (c < 100) return '雷暴';
  return '多云';
}

// ---------- Render ----------
function renderWeather(data) {
  document.getElementById('weather-icon').textContent = data.icon;
  document.getElementById('weather-temp').textContent = data.temp + '°C';
  document.getElementById('weather-desc').textContent = data.desc;
  document.getElementById('weather-city').textContent = '📍 ' + data.city;
  document.getElementById('weather-city').title = '点击切换城市';

  // City change handler (bind once)
  const cityEl = document.getElementById('weather-city');
  if (!cityEl._bound) {
    cityEl._bound = true;
    cityEl.addEventListener('click', async () => {
      const newCity = prompt('请输入城市名称（例如：北京、上海、东京）：', data.city || '');
      if (!newCity || !newCity.trim()) return;
      cityEl.textContent = '📍 查询中...';
      try {
        const url = `https://wttr.in/${encodeURIComponent(newCity.trim())}?format=j1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const json = await res.json();
        const cur = json.current_condition[0];
        const cityName = json.nearest_area[0].areaName[0].value || newCity.trim();
        saveCity(cityName);
        const code = Number(cur.weatherCode);
        const nd = {
          city: cityName,
          temp: Math.round(Number(cur.temp_C)),
          icon: weatherEmoji(code),
          desc: weatherDesc(code),
          humidity: cur.humidity
        };
        cacheWeather(nd);
        renderWeather(nd);
      } catch (e) {
        alert('查询失败，请检查城市名称是否正确。');
        cityEl.textContent = '📍 ' + data.city;
      }
    });
  }
}

function renderFallbackWeather() {
  const city = getLastCity() || '选择城市';
  document.getElementById('weather-icon').textContent = '🌤️';
  document.getElementById('weather-temp').textContent = '--°C';
  document.getElementById('weather-desc').textContent = '暂未获取';
  document.getElementById('weather-city').textContent = '📍 ' + city;
  document.getElementById('weather-city').title = '点击手动查询城市天气';
}

// Pre-load cached city name
document.addEventListener('DOMContentLoaded', () => {
  const c = getLastCity();
  if (c) {
    document.getElementById('weather-city').textContent = '📍 ' + c;
  }
});
