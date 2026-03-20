/* eslint-disable @next/next/no-img-element */

type Props = {
  latitude: number;
  longitude: number;
  label?: string;
};

export function NavigationLinks({ latitude, longitude, label }: Props) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const wazeUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
  const uberUrl = `https://m.uber.com/ul/?action=setPickup&dropoff[latitude]=${latitude}&dropoff[longitude]=${longitude}${label ? `&dropoff[nickname]=${encodeURIComponent(label)}` : ""}`;

  const links = [
    { href: mapsUrl, icon: "/taximetro/icons/gmaps.png", name: "Maps", ring: "hover:ring-blue-300" },
    { href: wazeUrl, icon: "/taximetro/icons/waze.png", name: "Waze", ring: "hover:ring-cyan-300" },
    { href: uberUrl, icon: "/taximetro/icons/uber.png", name: "Uber", ring: "hover:ring-gray-400" },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-background p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
        Como chegar
      </p>
      <div className="grid grid-cols-3 gap-2">
        {links.map((l) => (
          <a
            key={l.name}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-3 transition hover:shadow-md hover:ring-2 ${l.ring} active:scale-95`}
          >
            <img
              src={l.icon}
              alt={l.name}
              className="h-10 w-10 rounded-lg object-contain"
              draggable={false}
            />
            <span className="text-[11px] font-medium text-slate-900">{l.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
