// Patients already on file in the (simulated) practice-management system.
// Lena Park and Kwame Osei are deliberately missing: they are new patients.
export const CRM_PATIENTS = [
  { id: "P-10231", name: "Maria Okafor", dob: "1961-03-14", phone: "(555) 013-8820", plan: "Crestline Health Plan PPO", member_id: "CHP-77310554", coverage_effective: "2025-01-01" },
  { id: "P-10412", name: "Dennis Farrow", dob: "1954-11-02", phone: "(555) 014-2297", plan: null, member_id: null, coverage_effective: null },
  { id: "P-09877", name: "Rosa Alvarez", dob: "1970-12-01", phone: "(555) 012-6618", plan: "Crestline Health Plan PPO", member_id: "CHP-31190284", coverage_effective: "2024-07-01" },
  { id: "P-08120", name: "James Whitfield", dob: "1957-04-22", phone: "(555) 016-4410", plan: "Medicare Part B", member_id: "5TG2-QX8-HN41", coverage_effective: "2022-05-01" },
  { id: "P-11045", name: "Thomas Beck", dob: "1979-05-09", phone: "(555) 018-2231", plan: "BlueHarbor PPO", member_id: "BHP-11873302", coverage_effective: "2023-02-01" },
] as const;
