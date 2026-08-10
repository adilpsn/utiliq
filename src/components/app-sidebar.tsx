import { Link, useRouterState } from "@tanstack/react-router";
import {
  Antenna,
  ClipboardList,
  Calendar,
  History,
  RadioTower,
  Factory,
  Settings,
  Gauge,
  LineChart,
  LayoutGrid,
} from "lucide-react";
import { telemetryEnabled } from "@/lib/telemetry/flag";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

const baseItems = [
  { title: "Command Center", url: "/", icon: Gauge },
  { title: "Production Queue", url: "/queue", icon: ClipboardList },
  { title: "Schedule", url: "/schedule", icon: Calendar },
  { title: "Live Energy", url: "/live-energy", icon: RadioTower },
  { title: "Floor Layout", url: "/floor-layout", icon: LayoutGrid },
  { title: "Spot Market", url: "/analysis", icon: LineChart },
  { title: "Test Records", url: "/records", icon: History },
  { title: "Plant Resources", url: "/resources", icon: Factory },
  { title: "Settings", url: "/settings", icon: Settings },
];

// Only appears when VITE_TELEMETRY=1, so the demo build's navigation — and its
// rendered HTML — is unchanged from clickdummy-v1.
const telemetryItem = { title: "Telemetry", url: "/telemetry", icon: Antenna };

export function AppSidebar() {
  const items = telemetryEnabled() ? [...baseItems, telemetryItem] : baseItems;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-3">
          <img
            src="/utiliq-mark-light.png"
            alt=""
            className="h-8 w-8 shrink-0 object-contain dark:hidden"
          />
          <img
            src="/utiliq-mark-dark.png"
            alt=""
            className="hidden h-8 w-8 shrink-0 object-contain dark:block"
          />
          <div className="leading-none group-data-[collapsible=icon]:hidden">
            <img
              src="/utiliq-word-light.png"
              alt="Utiliq"
              className="h-5 object-contain dark:hidden"
            />
            <img
              src="/utiliq-word-dark.png"
              alt="Utiliq"
              className="hidden h-5 object-contain dark:block"
            />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-3">
                      <item.icon className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-wider">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between gap-1 px-2 py-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <SidebarTrigger className="text-muted-foreground" />
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
