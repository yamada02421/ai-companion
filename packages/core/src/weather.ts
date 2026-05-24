export interface WeatherInfo {
  city: string;
  temp: number;
  description: string;
  humidity: number;
  willRain: boolean;
  mainCondition?: string; // "Clear", "Rain", "Snow", "Clouds", "Drizzle", etc.
}

export interface WeatherMoodEffect {
  weatherMood: string;
  comment: string;
  moodBoost: { mood: string; weight: number } | null;
}

export async function fetchWeather(
  apiKey: string,
  city: string = "Tokyo"
): Promise<WeatherInfo> {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=ja`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Weather API error: ${res.status}`);
  }

  const data = await res.json();

  return {
    city: data.name,
    temp: Math.round(data.main.temp),
    description: data.weather[0].description,
    humidity: data.main.humidity,
    willRain: data.weather.some(
      (w: { main: string }) => w.main === "Rain" || w.main === "Drizzle"
    ),
    mainCondition: data.weather[0].main as string,
  };
}

export function formatWeatherContext(weather: WeatherInfo): string {
  const rain = weather.willRain ? "雨が降る予報です。傘が必要です。" : "";
  return `現在の天気: ${weather.city}は${weather.description}、気温${weather.temp}℃、湿度${weather.humidity}%。${rain}`;
}

/**
 * 天気に基づくムード修飾を返す。
 * 晴れ → happy加点、雨 → tired加点、雪 → curious加点、曇り → 変化なし
 */
export function getCurrentWeatherMood(weather: WeatherInfo): WeatherMoodEffect {
  const condition = weather.mainCondition ?? "";

  switch (condition) {
    case "Clear":
      return {
        weatherMood: "sunny_cheerful",
        comment: "天気がいいと気分も上がるね",
        moodBoost: { mood: "happy", weight: 1 },
      };
    case "Rain":
    case "Drizzle":
    case "Thunderstorm":
      return {
        weatherMood: "rain_cozy",
        comment: "雨の日はなんかまったりする",
        moodBoost: { mood: "tired", weight: 1 },
      };
    case "Snow":
      return {
        weatherMood: "snow_wonder",
        comment: "雪…なんだか不思議な気持ち",
        moodBoost: { mood: "curious", weight: 1 },
      };
    case "Clouds":
      return {
        weatherMood: "cloudy_calm",
        comment: "曇りの日は静かでいい",
        moodBoost: null,
      };
    default:
      return {
        weatherMood: "unknown",
        comment: "",
        moodBoost: null,
      };
  }
}
