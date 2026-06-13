/* ============================================================
   weather.js — 天气API获取与显示
   优先：浏览器定位 + Open-Meteo（无需API Key）
   回退：wttr.in IP定位
   ============================================================ */

const WEATHER_CACHE_KEY = 'tarot-weather-cache';
const WEATHER_CITY_KEY = 'tarot-weather-city';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

async function initWeather() {
  const cached = getWeatherCache();
  if (cached) {
    renderWeather(cached);
    document.getElementById('weather-desc').textContent = cached.desc;
    return;
  }

  // Show loading state
  const lastCity = getLastCity();
  if (lastCity) {
    document.getElementById('weather-city').textContent = '📍 ' + lastCity;
  }

  // Race with timeout (8s max)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 8000)
  );

  try {
    const data = await Promise.race([fetchWeatherByGeolocation(), timeout]);
    if (data) {
      cacheWeather(data);
      renderWeather(data);
      return;
    }
  } catch (e) {
    console.log('Geolocation weather failed, trying wttr.in...');
  }

  try {
    const data = await Promise.race([fetchWeatherByWttr(), timeout]);
    if (data) {
      cacheWeather(data);
      renderWeather(data);
      return;
    }
  } catch (e) {
    console.log('wttr.in weather failed');
  }

  // Final fallback — show cached city with neutral display
  document.getElementById('weather-icon').textContent = '🌤️';
  document.getElementById('weather-temp').textContent = '--°C';
  document.getElementById('weather-desc').textContent = '点击📍切换城市';
  document.getElementById('weather-city').textContent = '📍 ' + (getLastCity() || '选择城市');
}

function getWeatherCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY));
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }
  } catch (e) {}
  return null;
}

function cacheWeather(data) {
  localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now()
  }));
}

function getLastCity() {
  return localStorage.getItem(WEATHER_CITY_KEY) || '';
}

function saveCity(city) {
  localStorage.setItem(WEATHER_CITY_KEY, city);
}

async function fetchWeatherByGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          // Open-Meteo API (free, no key)
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=auto`;
          const res = await fetch(url);
          const json = await res.json();

          if (json.current_weather) {
            const w = json.current_weather;
            // Get city name via reverse geocoding
            let city = '当前位置';
            try {
              const geoRes = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=zh`
              );
              const geoJson = await geoRes.json();
              city = geoJson.address
                ? (geoJson.address.city || geoJson.address.town || geoJson.address.county || geoJson.address.state || '当前位置')
                : '当前位置';
              saveCity(city);
            } catch (e) {}

            resolve({
              city,
              temp: Math.round(w.temperature),
              icon: getWeatherEmoji(w.weathercode),
              desc: getWeatherDesc(w.weathercode),
              wind: w.windspeed
            });
          } else {
            reject(new Error('No current weather data'));
          }
        } catch (e) {
          reject(e);
        }
      },
      (err) => reject(err),
      { timeout: 10000, enableHighAccuracy: false }
    );
  });
}

async function fetchWeatherByWttr() {
  const url = 'https://wttr.in/?format=j1';
  const res = await fetch(url);
  const json = await res.json();

  const current = json.current_condition[0];
  const nearest = json.nearest_area[0];

  const city = nearest.areaName[0].value || '当前位置';
  saveCity(city);

  const code = parseInt(current.weatherCode);

  return {
    city,
    temp: parseInt(current.temp_C),
    icon: getWeatherEmoji(code),
    desc: getWeatherDesc(code),
    humidity: current.humidity
  };
}

function getWeatherEmoji(code) {
  const map = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌦️',
    61: '🌧️', 63: '🌧️', 65: '🌧️', 71: '🌨️', 73: '🌨️', 75: '🌨️',
    80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '🌨️',
    95: '⛈️', 96: '⛈️', 99: '⛈️'
  };
  return map[code] || '🌤️';
}

function getWeatherDesc(code) {
  const map = {
    0: '晴朗', 1: '大部晴朗', 2: '多云', 3: '阴天',
    45: '有雾', 48: '霜雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '中阵雨', 82: '大阵雨', 85: '小阵雪', 86: '大阵雪',
    95: '雷暴', 96: '冰雹雷暴', 99: '强冰雹雷暴'
  };
  return map[code] || '天气未知';
}

function renderWeather(data) {
  document.getElementById('weather-icon').textContent = data.icon;
  document.getElementById('weather-temp').textContent = `${data.temp}°C`;
  document.getElementById('weather-desc').textContent = data.desc;
  document.getElementById('weather-city').textContent = `📍 ${data.city}`;
  document.getElementById('weather-city').title = '点击切换城市';

  // City change on click
  document.getElementById('weather-city').addEventListener('click', async () => {
    const newCity = prompt('请输入城市名称（例如：北京、上海、东京）：', data.city);
    if (newCity && newCity.trim()) {
      document.getElementById('weather-city').textContent = '📍 查询中...';
      try {
        const url = `https://wttr.in/${encodeURIComponent(newCity.trim())}?format=j1`;
        const res = await fetch(url);
        const json = await res.json();
        const current = json.current_condition[0];
        const cityName = json.nearest_area[0].areaName[0].value || newCity.trim();
        saveCity(cityName);
        const code = parseInt(current.weatherCode);
        const newData = {
          city: cityName,
          temp: parseInt(current.temp_C),
          icon: getWeatherEmoji(code),
          desc: getWeatherDesc(code),
          humidity: current.humidity
        };
        cacheWeather(newData);
        renderWeather(newData);
      } catch (e) {
        alert('查询天气失败，请检查城市名称是否正确。');
        document.getElementById('weather-city').textContent = `📍 ${data.city}`;
      }
    }
  });
}

// Also try to load cached city on startup
document.addEventListener('DOMContentLoaded', () => {
  const cachedCity = getLastCity();
  if (cachedCity) {
    document.getElementById('weather-city').textContent = `📍 ${cachedCity}`;
  }
});
