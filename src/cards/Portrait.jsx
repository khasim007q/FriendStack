export default function Portrait({
  face = 0,
  color = "lavender",
  className = "",
}) {
  const palette = {
    lavender: ["#d8c7f5", "#b196d3", "#493e5c"],
    peach: ["#f1bca3", "#d98b6f", "#5d3d38"],
    mint: ["#b9d9c2", "#83b69b", "#374e45"],
  }[color] || ["#d8c7f5", "#b196d3", "#493e5c"];
  return (
    <svg
      className={`friend-portrait ${className}`}
      viewBox="0 0 240 230"
      role="img"
      aria-label="Illustrated fictional character portrait"
    >
      <defs>
        <pattern
          id={`dots-${color}-${face}`}
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2" cy="2" r="1" fill={palette[2]} opacity=".14" />
        </pattern>
      </defs>
      <rect width="240" height="230" fill={palette[0]} />
      <rect width="240" height="230" fill={`url(#dots-${color}-${face})`} />
      <circle
        cx="120"
        cy="100"
        r="73"
        fill="none"
        stroke={palette[2]}
        strokeWidth="1"
        opacity=".2"
      />
      <path
        d="M15 40h35m-18-17v35M200 150h24m-12-12v24"
        stroke={palette[2]}
        strokeWidth="1.3"
        opacity=".5"
      />
      {face === 0 ? (
        <>
          <path
            d="M60 228v-61c0-24 20-45 60-45s61 21 61 45v61"
            fill="#373642"
          />
          <path d="M108 120h25v35l-12 12-13-12" fill="#bc806b" />
          <path
            d="M80 84c-5-48 31-62 56-49 31 3 35 38 22 68l12 67c-23 10-76 6-96-7l11-58"
            fill="#453b38"
          />
          <path
            d="M88 81c1-25 12-34 34-34 28 0 33 18 31 39l-6 28c-5 15-17 23-27 23-14-1-27-16-29-31"
            fill="#dca58a"
          />
          <path
            d="M86 79c13 4 35-6 45-26 0 14 10 28 23 30l1-26-31-17-35 11"
            fill="#453b38"
          />
          <path
            d="m110 104 3 6h9"
            fill="none"
            stroke="#a66a59"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M111 118q11 5 19-2"
            fill="none"
            stroke="#69463e"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M93 91h18m13 0h19m-31 3h11"
            stroke="#3d393a"
            strokeWidth="3"
          />
          <rect
            x="91"
            y="88"
            width="22"
            height="15"
            rx="6"
            fill="none"
            stroke="#3d393a"
            strokeWidth="2.5"
          />
          <rect
            x="122"
            y="88"
            width="23"
            height="15"
            rx="6"
            fill="none"
            stroke="#3d393a"
            strokeWidth="2.5"
          />
          <path d="m82 161 21-10 17 17 18-17 20 10-12 67H94" fill="#d7c8e3" />
          <path
            d="m108 155 12 13-15 14-9-25m38-3-14 14 16 14 9-25"
            fill="#f1e4e9"
          />
          <circle cx="121" cy="193" r="3" fill="#6c5d74" />
        </>
      ) : face === 1 ? (
        <>
          <path
            d="M54 230v-52c0-30 23-44 66-44s67 19 67 46v50"
            fill="#b8543c"
          />
          <path d="m107 120 26-1v32l-13 14-13-12" fill="#ae785b" />
          <path
            d="M80 69c-2-32 30-43 54-32 29-3 36 27 23 48l-15-10"
            fill="#353b39"
          />
          <path
            d="M85 74c0-19 13-29 33-29s38 17 35 40l-3 29c-7 17-18 26-30 25-14-2-29-16-32-34"
            fill="#ce9673"
          />
          <ellipse cx="84" cy="93" rx="7" ry="11" fill="#ce9673" />
          <ellipse cx="154" cy="94" rx="7" ry="11" fill="#ce9673" />
          <path
            d="M80 73c15 5 35-12 40-21 6 12 20 23 37 24l1-20-34-17-40 13"
            fill="#353b39"
          />
          <path
            d="m96 87 14-2m18 0 13 3"
            stroke="#514233"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="105" cy="94" r="2" fill="#35352e" />
          <circle cx="134" cy="95" r="2" fill="#35352e" />
          <path
            d="m120 96-3 13h7m-19 7q13 17 28-1"
            fill="none"
            stroke="#664330"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="m104 146 15 17 16-18 20 9-13 76H94l-10-73" fill="#efe0bb" />
          <path d="m59 184 35-17m59-1 28 17" stroke="#824831" strokeWidth="3" />
          <path
            d="m100 178 21 13 21-13"
            fill="none"
            stroke="#aa8256"
            strokeWidth="2"
          />
          <circle
            cx="157"
            cy="108"
            r="4"
            fill="none"
            stroke="#edd495"
            strokeWidth="2"
          />
        </>
      ) : (
        <>
          <path
            d="M55 230v-49c0-30 28-46 65-46 39 0 65 16 65 46v49"
            fill="#304e4c"
          />
          <path d="M107 120h25v35l-12 12-14-15" fill="#986c54" />
          <path
            d="M78 94c-12-31-1-61 29-63 28-8 57 7 55 40l-9 34"
            fill="#323a35"
          />
          <path
            d="M88 71c6-20 22-27 39-23 18 2 29 15 26 40l-6 29c-8 17-20 21-30 18-13-4-23-17-27-34"
            fill="#b88762"
          />
          <path
            d="M82 79c20-4 33-17 41-30 2 12 14 26 31 30l5-22-33-18-39 16"
            fill="#323a35"
          />
          <path
            d="m98 87 12-2m18 1 12 3"
            stroke="#52402f"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="105" cy="94" r="2" fill="#32352b" />
          <circle cx="133" cy="95" r="2" fill="#32352b" />
          <path
            d="m118 94-2 15h7m-16 9 22-1"
            fill="none"
            stroke="#6d4b36"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="m103 147 17 18 16-17 18 9-11 73H97l-12-73" fill="#c0cbb9" />
          <path d="m112 162 8 4 8-4-8 65" fill="#5b6d5b" />
          <path
            d="m95 151-15 14 12 16-10 13 16 36m44-79 16 15-12 15 13 12-18 37"
            fill="none"
            stroke="#68817b"
            strokeWidth="2"
          />
        </>
      )}
      <path
        d="m185 32 4 9 9 4-9 4-4 9-4-9-9-4 9-4z"
        fill={palette[2]}
        opacity=".5"
      />
    </svg>
  );
}
