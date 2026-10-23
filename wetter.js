(function(){
  const KEY='chroniken_weather_state_v1';
  const SLOT_MS=6*60*60*1000;
  const DEFAULT_WEATHER=[
    ['Klarer Himmel','☀️','Ein ruhiger, heller Tag liegt über dem Land.'],
    ['Leichter Wind','🍃','Ein sanfter Wind zieht durch Wälder und Gassen.'],
    ['Bewölkt','☁️','Wolken ziehen über den Himmel, doch es bleibt trocken.'],
    ['Nebel','🌫️','Dichter Nebel liegt über dem Land und verschluckt die Ferne.'],
    ['Leichter Regen','🌦️','Feiner Regen fällt und lässt die Straßen glänzen.'],
    ['Starker Regen','🌧️','Kräftiger Regen prasselt auf Dächer und Wege.'],
    ['Gewitter','⛈️','Donner grollt am Horizont und Blitze erhellen die Wolken.'],
    ['Starker Wind','🌬️','Böen ziehen durch das Land und lassen Äste rauschen.'],
    ['Schneefall','🌨️','Leiser Schnee fällt vom Himmel und bedeckt die Landschaft.'],
    ['Starker Schneefall','❄️','Dichter Schnee fällt und macht Wege langsam schwer passierbar.'],
    ['Frost','🥶','Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft.'],
    ['Dunstiger Morgen','🌤️','Heller Dunst liegt über dem Land und löst sich langsam auf.']
  ];
  function getWeatherList(){
    // Primär: zentrale Verwaltung (localStorage "wetter", Objekte {name,icon,description})
    try{
      const x=JSON.parse(localStorage.getItem('wetter')||'null');
      if(Array.isArray(x) && x.length){
        return x.filter(w=>w&&w.name).map(w=>[w.name,w.icon||'🌦️',w.description||'']);
      }
    }catch{}
    // Fallback: alte eigene Wetterlagen + Standards
    let custom=[];
    try{const y=JSON.parse(localStorage.getItem('chroniken_custom_weather_v1')||'[]'); if(Array.isArray(y)) custom=y.filter(w=>w&&w[0]);}catch{}
    return DEFAULT_WEATHER.concat(custom);
  }
  function slot(){return Math.floor(Date.now()/SLOT_MS)}
  function pick(s){
    const WEATHER=getWeatherList();
    let x=(s*1103515245+12345)>>>0;
    x=((x^(x>>>16))*2246822519)>>>0;
    return WEATHER[x%WEATHER.length];
  }
  function get(){
    const s=slot(), w=pick(s), prev=JSON.parse(localStorage.getItem(KEY)||'null');
    const state={slot:s,name:w[0],icon:w[1],description:w[2],changedAt:new Date(s*SLOT_MS).toISOString()};
    if(!prev || prev.slot!==s) localStorage.setItem(KEY,JSON.stringify(state));
    return state;
  }
  function msNext(){return SLOT_MS-(Date.now()%SLOT_MS)}
  function format(ms){
    const total=Math.max(0,Math.floor(ms/1000));
    const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  // notifyIfChanged bleibt als No-Op, falls andere Seiten es noch aufrufen
  async function notifyIfChanged(){ return true; }
  window.ChronikenWeather={get,msNext,format,notifyIfChanged,WEATHER:getWeatherList(),getWeatherList,SLOT_MS};
  get();
})();
