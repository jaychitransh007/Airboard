import type { Metadata } from "next";
import { BoardsPage } from "../../../src/features/product/BoardsPage";

export const metadata: Metadata = { title: "Boards" };
export default function Boards() { return <BoardsPage />; }
