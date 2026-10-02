const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
};

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  host: "0.0.0.0",
  aiBaseUrl: (process.env.ACTIVITYINFO_BASE_URL ?? "https://www.activityinfo.org").replace(/\/$/, ""),
  sessionSecret: required("SESSION_SECRET"),
  trustProxy: true,
} as const;
