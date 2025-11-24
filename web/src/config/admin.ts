export const PRIMARY_ADMIN_EMAIL = (import.meta.env.VITE_PRIMARY_ADMIN_EMAIL || "").trim().toLowerCase();

export const normalizeEmail = (value?: string | null) => (value || "").trim().toLowerCase();
