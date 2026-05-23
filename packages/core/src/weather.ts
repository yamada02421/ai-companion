export interface WeatherInfo {
  city: string;
  temp: number;
  description: string;
  humidity: number;
  willRain: boolean;
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
  };
}

export function formatWeatherContext(weather: WeatherInfo): string {
  const rain = weather.willRain ? "雨が降る予報です。傘が必要です。" : "";
  return `現在の天気: ${weather.city}は${weather.description}、気温${weather.temp}℃、湿度${weather.humidity}%。${rain}`;
}
