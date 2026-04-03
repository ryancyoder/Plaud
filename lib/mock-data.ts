import { Transcript, ActionItem, CallItem, ErrandItem } from "./types";

// Helper to get dates for the current week (Mon-Sun)
function getCurrentWeekDates(): string[] {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

function getNextWeekDates(): string[] {
  const now = new Date();
  const day = now.getDay();
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(nextMonday);
    d.setDate(nextMonday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

const week = getCurrentWeekDates();
const nextWeek = getNextWeekDates();

export const transcripts: Transcript[] = [
  {
    id: "t1",
    title: "Weekly Team Standup",
    date: week[0],
    startTime: "09:00",
    duration: 25,
    summary: "Sprint progress review. Backend API 80% complete. Frontend blocked on design specs. Need to resolve auth token expiration issue before Wednesday.",
    participants: ["Sarah Chen", "Mike Ross", "Priya Patel"],
    tags: ["meeting"],
    actionItems: [
      { id: "a1", text: "Review PR #247 for auth token fix", done: false, source: "Weekly Team Standup" },
      { id: "a2", text: "Send design specs to frontend team", done: false, source: "Weekly Team Standup", dueDate: week[1] },
    ],
    calls: [],
    errands: [],
  },
  {
    id: "t2",
    title: "Call with Dr. Martinez",
    date: week[0],
    startTime: "14:30",
    duration: 12,
    summary: "Follow-up on lab results. Everything looks normal. Schedule next appointment in 3 months. Pick up prescription refill.",
    participants: ["Dr. Martinez"],
    tags: ["medical", "call"],
    actionItems: [
      { id: "a3", text: "Schedule follow-up appointment for July", done: false, source: "Call with Dr. Martinez" },
    ],
    calls: [
      { id: "c1", person: "Dr. Martinez's office", reason: "Schedule 3-month follow-up", done: false, source: "Call with Dr. Martinez" },
    ],
    errands: [
      { id: "e1", text: "Pick up prescription refill", done: false, source: "Call with Dr. Martinez", location: "CVS Pharmacy" },
    ],
  },
  {
    id: "t3",
    title: "Product Roadmap Planning",
    date: week[1],
    startTime: "10:00",
    duration: 55,
    summary: "Q3 priorities defined: AI search feature, mobile redesign, and performance optimization. Budget approved for 2 new hires. Launch target: August 15.",
    participants: ["Sarah Chen", "James Wong", "Lisa Park", "David Kim"],
    tags: ["meeting", "brainstorm"],
    actionItems: [
      { id: "a4", text: "Draft job posting for senior frontend developer", done: false, source: "Product Roadmap Planning" },
      { id: "a5", text: "Create detailed timeline for AI search feature", done: false, source: "Product Roadmap Planning", dueDate: week[3] },
      { id: "a6", text: "Set up performance monitoring dashboard", done: true, source: "Product Roadmap Planning" },
    ],
    calls: [],
    errands: [],
  },
  {
    id: "t4",
    title: "Lunch with Alex",
    date: week[1],
    startTime: "12:30",
    duration: 40,
    summary: "Caught up on personal stuff. Alex is considering changing jobs. Mentioned a good book recommendation: 'Thinking in Systems'. Plans for weekend hiking trip.",
    participants: ["Alex Rivera"],
    tags: ["personal"],
    actionItems: [
      { id: "a7", text: "Order 'Thinking in Systems' book", done: false, source: "Lunch with Alex" },
    ],
    calls: [
      { id: "c2", person: "Alex Rivera", reason: "Confirm weekend hiking plans", done: false, source: "Lunch with Alex" },
    ],
    errands: [
      { id: "e2", text: "Pick up hiking boots from REI", done: false, source: "Lunch with Alex", location: "REI" },
    ],
  },
  {
    id: "t5",
    title: "Client Call - Acme Corp",
    date: week[2],
    startTime: "11:00",
    duration: 35,
    summary: "Demo of new dashboard features. Client impressed with analytics module. Requested custom export formats. Contract renewal discussion - they want a 2-year deal.",
    participants: ["Tom Bradley", "Janet Liu"],
    tags: ["call", "meeting"],
    actionItems: [
      { id: "a8", text: "Send proposal for custom export feature", done: false, source: "Client Call - Acme Corp", dueDate: week[4] },
      { id: "a9", text: "Prepare 2-year contract terms", done: false, source: "Client Call - Acme Corp" },
    ],
    calls: [
      { id: "c3", person: "Janet Liu", reason: "Follow up on contract terms", done: false, source: "Client Call - Acme Corp" },
    ],
    errands: [],
  },
  {
    id: "t6",
    title: "1:1 with Manager",
    date: week[2],
    startTime: "15:00",
    duration: 30,
    summary: "Performance review prep. Discussed career growth path. Manager supportive of conference attendance. Need to complete self-assessment by Friday.",
    participants: ["Rachel Green"],
    tags: ["meeting"],
    actionItems: [
      { id: "a10", text: "Complete self-assessment form", done: false, source: "1:1 with Manager", dueDate: week[4] },
      { id: "a11", text: "Research conferences for Q3", done: false, source: "1:1 with Manager" },
    ],
    calls: [],
    errands: [],
  },
  {
    id: "t7",
    title: "Brainstorm - AI Features",
    date: week[3],
    startTime: "14:00",
    duration: 45,
    summary: "Explored AI-powered search, auto-tagging, and smart summaries. Consensus to start with search. Need to evaluate 3 LLM providers. Prototype target: 2 weeks.",
    participants: ["Mike Ross", "Priya Patel", "David Kim"],
    tags: ["brainstorm", "meeting"],
    actionItems: [
      { id: "a12", text: "Evaluate OpenAI, Anthropic, and Cohere APIs", done: false, source: "Brainstorm - AI Features" },
      { id: "a13", text: "Set up prototype repo for AI search", done: false, source: "Brainstorm - AI Features" },
    ],
    calls: [],
    errands: [],
  },
  {
    id: "t8",
    title: "Dentist Appointment Reminder",
    date: week[3],
    startTime: "09:15",
    duration: 5,
    summary: "Voicemail from dentist office confirming appointment next Tuesday at 2pm. Need to bring insurance card.",
    participants: [],
    tags: ["personal", "medical"],
    actionItems: [],
    calls: [
      { id: "c4", person: "Dentist office", reason: "Confirm Tuesday 2pm appointment", done: false, source: "Dentist Appointment Reminder" },
    ],
    errands: [
      { id: "e3", text: "Find and bring insurance card to dentist", done: false, source: "Dentist Appointment Reminder" },
    ],
  },
  {
    id: "t9",
    title: "Interview - Senior Dev Candidate",
    date: week[4],
    startTime: "13:00",
    duration: 60,
    summary: "Strong candidate - 8 years React experience, good system design skills. Slight concern about team collaboration style. Recommend moving to final round.",
    participants: ["Jordan Blake"],
    tags: ["interview"],
    actionItems: [
      { id: "a14", text: "Submit interview feedback by Monday", done: false, source: "Interview - Senior Dev Candidate" },
      { id: "a15", text: "Schedule final round with hiring committee", done: false, source: "Interview - Senior Dev Candidate" },
    ],
    calls: [],
    errands: [],
  },
  {
    id: "t10",
    title: "Quick note - grocery list",
    date: week[4],
    startTime: "17:45",
    duration: 2,
    summary: "Reminder to pick up groceries: milk, eggs, bread, chicken, broccoli, rice, olive oil.",
    participants: [],
    tags: ["personal", "errand"],
    actionItems: [],
    calls: [],
    errands: [
      { id: "e4", text: "Grocery run: milk, eggs, bread, chicken, broccoli, rice, olive oil", done: false, source: "Quick note - grocery list", location: "Trader Joe's" },
    ],
  },
  // Next week transcripts (fewer, as they're upcoming)
  {
    id: "t11",
    title: "Sprint Planning",
    date: nextWeek[0],
    startTime: "09:30",
    duration: 60,
    summary: "Upcoming sprint planning session for the AI search feature kickoff and mobile redesign continuation.",
    participants: ["Sarah Chen", "Mike Ross", "Priya Patel", "David Kim"],
    tags: ["meeting"],
    actionItems: [],
    calls: [],
    errands: [],
  },
  {
    id: "t12",
    title: "Dentist Appointment",
    date: nextWeek[1],
    startTime: "14:00",
    duration: 60,
    summary: "Scheduled dental cleaning and checkup.",
    participants: [],
    tags: ["personal", "medical"],
    actionItems: [],
    calls: [],
    errands: [
      { id: "e5", text: "Bring insurance card to dentist", done: false, source: "Dentist Appointment" },
    ],
  },
  {
    id: "t13",
    title: "Acme Corp Follow-up",
    date: nextWeek[2],
    startTime: "10:00",
    duration: 30,
    summary: "Follow-up meeting to discuss contract renewal terms and custom export feature timeline.",
    participants: ["Tom Bradley", "Janet Liu"],
    tags: ["call", "meeting"],
    actionItems: [],
    calls: [],
    errands: [],
  },
];

export function getTranscriptsForDate(date: string): Transcript[] {
  return transcripts.filter((t) => t.date === date);
}

export function getTranscriptsForWeek(weekDates: string[]): Transcript[] {
  return transcripts.filter((t) => weekDates.includes(t.date));
}

export function getAllActionItems(): ActionItem[] {
  return transcripts.flatMap((t) => t.actionItems);
}

export function getAllCallItems(): CallItem[] {
  return transcripts.flatMap((t) => t.calls);
}

export function getAllErrandItems(): ErrandItem[] {
  return transcripts.flatMap((t) => t.errands);
}

export function getWeekDates(offset: number = 0): string[] {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}
