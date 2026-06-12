import MissionConsole from "./components/mission-console";

export default function Home() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-5">
      <div className="flex min-h-0 flex-1 flex-col border border-phosphor/20">
        <header className="reveal flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-phosphor/15 px-5 py-4 sm:px-8">
          <h1 className="text-sm font-semibold tracking-[0.35em] text-foreground">
            ORBIT<span className="text-phosphor">▮</span>EXPLORER
          </h1>
          <span className="hidden text-[11px] tracking-[0.25em] text-foreground/40 sm:inline">
            MISSION CONSOLE 01
          </span>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <MissionConsole />
        </main>

        <footer className="reveal flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-phosphor/15 px-5 py-3 sm:px-8 [animation-delay:600ms]">
          <span className="whitespace-nowrap text-[10px] tracking-[0.25em] text-foreground/40">
            GP DATA · CELESTRAK
          </span>
          <span className="whitespace-nowrap text-[10px] tracking-[0.25em] text-foreground/40">
            <span className="sm:hidden">SGP4 · CLIENT-SIDE · 1 HZ</span>
            <span className="hidden sm:inline">
              SGP4 PROPAGATION · COMPUTED CLIENT-SIDE · 1 HZ
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}
