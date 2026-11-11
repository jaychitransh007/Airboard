import { redirect } from "next/navigation";

// Boards live on the home page now; old links and bookmarks land there.
export default function Boards() { redirect("/app"); }
