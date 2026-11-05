/**
 * Starter boards. Each template is a short script of ordinary Airo commands,
 * run once on the new empty board, so a template builds exactly the diagram a
 * person would get by typing the same commands, and teaches the grammar too.
 */
export type BoardTemplate = {
  id: string;
  title: string;
  description: string;
  commands: readonly string[];
};

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: "system-architecture",
    title: "System architecture",
    description: "A customer, web app, API, service, queue and database, already connected",
    commands: [
      "add a user called Customer",
      "add a frontend called Web app to the right of Customer",
      "add an API called API gateway to the right of Web app",
      "add a service called Orders to the right of API gateway",
      "add a database called Orders DB below Orders",
      "add a queue called Events below API gateway",
      "connect Customer to Web app",
      "connect Web app to API gateway",
      "connect API gateway to Orders",
      "connect Orders to Orders DB",
      "connect API gateway to Events",
    ],
  },
  {
    id: "teaching-canvas",
    title: "Teaching canvas",
    description: "Concept, example, practice and summary, with a check for understanding",
    commands: [
      "add a process called Concept",
      "add a process called Example to the right of Concept",
      "add a process called Practice to the right of Example",
      "add a process called Summary to the right of Practice",
      "add a decision called Check understanding below Practice",
      "add a sticky note called Replace each step with your topic below Concept",
      "connect Concept to Example",
      "connect Example to Practice",
      "connect Practice to Summary",
      "connect Practice to Check understanding",
    ],
  },
  {
    id: "workshop-map",
    title: "Workshop map",
    description: "Problem, ideas, decision and next steps for a working session",
    commands: [
      "add a sticky note called Problem",
      "add a sticky note called Ideas to the right of Problem",
      "add a sticky note called Decision to the right of Ideas",
      "add a sticky note called Owners and next steps to the right of Decision",
      "connect Problem to Ideas",
      "connect Ideas to Decision",
      "connect Decision to Owners and next steps",
    ],
  },
  {
    id: "sales-narrative",
    title: "Sales narrative",
    description: "Customer, problem, what changed, your solution and the proof",
    commands: [
      "add a user called Customer",
      "add a process called Problem to the right of Customer",
      "add a process called What changed to the right of Problem",
      "add a process called Our solution to the right of What changed",
      "add a process called Proof to the right of Our solution",
      "add a sticky note called Add a customer quote or metric below Proof",
      "connect Customer to Problem",
      "connect Problem to What changed",
      "connect What changed to Our solution",
      "connect Our solution to Proof",
    ],
  },
];

export function boardTemplate(id: string | null | undefined): BoardTemplate | null {
  return BOARD_TEMPLATES.find((template) => template.id === id) ?? null;
}
