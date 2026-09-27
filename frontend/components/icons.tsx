const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };

export const IconDashboard = () => (
  <svg {...common}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
);
export const IconJobs = () => (
  <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>
);
export const IconClients = () => (
  <svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9" r="2.4" /><path d="M15.5 20a4.2 4.2 0 0 1 6.8-3.3" /></svg>
);
export const IconInvoices = () => (
  <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></svg>
);
export const IconPurchases = () => (
  <svg {...common}><path d="M6 8V6a3 3 0 0 1 6 0v2" /><rect x="4" y="8" width="16" height="12" rx="2" /></svg>
);
export const IconBills = () => (
  <svg {...common}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 3v3M16 3v3" /></svg>
);
export const IconCash = () => (
  <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /></svg>
);
export const IconInvestors = () => (
  <svg {...common}><path d="M21 12a9 9 0 1 1-9-9v9Z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z" /></svg>
);
export const IconExpenses = () => (
  <svg {...common}><path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6" /><circle cx="16" cy="14" r="1.2" /></svg>
);
export const IconUsers = () => (
  <svg {...common}><path d="M12 3 4 6v6c0 4.6 3.4 7.6 8 9 4.6-1.4 8-4.4 8-9V6Z" /></svg>
);
export const IconExchange = () => (
  <svg {...common}><path d="M4 7h13M17 7l-3-3M17 7l-3 3" /><path d="M20 17H7M7 17l3 3M7 17l3-3" /></svg>
);
export const IconTheme = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" /></svg>
);
export const IconPlus = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
);
export const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconHome = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h12v-9" /></svg>
);
export const IconMore = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
);
export const IconEdit = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
);
export const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
