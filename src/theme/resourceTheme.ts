import {
  Boxes,
  CircleDot,
  Clock3,
  Container,
  Database,
  GalleryVerticalEnd,
  FileKey2,
  GitCommitHorizontal,
  GitBranch,
  HardDrive,
  Layers3,
  LayoutDashboard,
  Link2,
  Network,
  Server,
  Settings2,
  Shield,
  Star,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  kind?: string;
};

export type KindTheme = {
  label: string;
  icon: LucideIcon;
  accent: "green" | "blue" | "orange";
  actions: string[];
};

export const pinnedResourcesNavId = "pinned-resources";

export const navSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Pinned",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: pinnedResourcesNavId, label: "Pinned", icon: Star },
      { id: "Pod", label: "Pods", icon: Container, kind: "Pod" },
      { id: "Node", label: "Nodes", icon: Server, kind: "Node" },
      { id: "Namespace", label: "Namespaces", icon: Layers3, kind: "Namespace" },
      { id: "Event", label: "Events", icon: Clock3, kind: "Event" },
    ],
  },
  {
    title: "Workloads",
    items: [
      { id: "Deployment", label: "Deployments", icon: GitBranch, kind: "Deployment" },
      { id: "ReplicaSet", label: "ReplicaSets", icon: GitCommitHorizontal, kind: "ReplicaSet" },
      { id: "StatefulSet", label: "StatefulSets", icon: Boxes, kind: "StatefulSet" },
      { id: "DaemonSet", label: "DaemonSets", icon: CircleDot, kind: "DaemonSet" },
      { id: "Job", label: "Jobs", icon: Clock3, kind: "Job" },
      { id: "CronJob", label: "CronJobs", icon: Clock3, kind: "CronJob" },
    ],
  },
  {
    title: "Traffic",
    items: [
      { id: "Service", label: "Services", icon: Network, kind: "Service" },
      { id: "EndpointSlice", label: "EndpointSlices", icon: Network, kind: "EndpointSlice" },
      { id: "Gateway", label: "Gateways", icon: Network, kind: "Gateway" },
      { id: "HTTPRoute", label: "HTTPRoutes", icon: Network, kind: "HTTPRoute" },
      { id: "Ingress", label: "Ingresses", icon: Network, kind: "Ingress" },
    ],
  },
  {
    title: "Storage",
    items: [
      { id: "PersistentVolumeClaim", label: "PVCs", icon: HardDrive, kind: "PersistentVolumeClaim" },
      { id: "PersistentVolume", label: "PVs", icon: Database, kind: "PersistentVolume" },
      { id: "StorageClass", label: "StorageClasses", icon: Database, kind: "StorageClass" },
    ],
  },
  {
    title: "Packages",
    items: [
      { id: "HelmRelease", label: "Helm", icon: GalleryVerticalEnd, kind: "HelmRelease" },
    ],
  },
  {
    title: "Config",
    items: [
      { id: "ConfigMap", label: "ConfigMaps", icon: Settings2, kind: "ConfigMap" },
      { id: "Secret", label: "Secrets", icon: FileKey2, kind: "Secret" },
      { id: "ServiceAccount", label: "ServiceAccounts", icon: Shield, kind: "ServiceAccount" },
      { id: "Role", label: "Roles", icon: Shield, kind: "Role" },
      { id: "RoleBinding", label: "Bindings", icon: Link2, kind: "RoleBinding" },
      { id: "ClusterRole", label: "ClusterRoles", icon: Shield, kind: "ClusterRole" },
      { id: "ClusterRoleBinding", label: "ClusterBindings", icon: Link2, kind: "ClusterRoleBinding" },
      { id: "CustomResourceDefinition", label: "CRDs", icon: Boxes, kind: "CustomResourceDefinition" },
    ],
  },
];

export const overviewCards = [
  { label: "Nodes", kind: "Node", icon: Server },
  { label: "Pods", kind: "Pod", icon: Container },
  { label: "Namespaces", kind: "Namespace", icon: Layers3 },
  { label: "Services", kind: "Service", icon: Network },
] satisfies Array<{ label: string; kind: string; icon: LucideIcon }>;

const fallbackTheme: KindTheme = {
  label: "Resources",
  icon: LayoutDashboard,
  accent: "green",
  actions: ["YAML", "Events", "Describe"],
};

export const kindThemes: Record<string, KindTheme> = {
  Pod: { label: "Pods", icon: Container, accent: "green", actions: ["Logs", "Exec", "YAML"] },
  Node: { label: "Nodes", icon: Server, accent: "blue", actions: ["Shell", "Drain", "YAML"] },
  Namespace: { label: "Namespaces", icon: Layers3, accent: "green", actions: ["Quota", "Events", "YAML"] },
  Deployment: { label: "Deployments", icon: GitBranch, accent: "green", actions: ["Scale", "Restart", "Rollback"] },
  ReplicaSet: { label: "ReplicaSets", icon: GitCommitHorizontal, accent: "green", actions: ["Pods", "Owner", "YAML"] },
  StatefulSet: { label: "StatefulSets", icon: Boxes, accent: "green", actions: ["Scale", "Restart", "YAML"] },
  DaemonSet: { label: "DaemonSets", icon: CircleDot, accent: "green", actions: ["Restart", "Events", "YAML"] },
  Job: { label: "Jobs", icon: Clock3, accent: "orange", actions: ["Rerun", "Logs", "YAML"] },
  CronJob: { label: "CronJobs", icon: Clock3, accent: "orange", actions: ["Trigger", "Suspend", "YAML"] },
  Service: { label: "Services", icon: Network, accent: "blue", actions: ["Port", "Endpoints", "YAML"] },
  EndpointSlice: { label: "EndpointSlices", icon: Network, accent: "blue", actions: ["Service", "Pods", "YAML"] },
  Gateway: { label: "Gateways", icon: Network, accent: "blue", actions: ["Routes", "Events", "YAML"] },
  HTTPRoute: { label: "HTTPRoutes", icon: Network, accent: "blue", actions: ["Parents", "Refs", "YAML"] },
  Ingress: { label: "Ingresses", icon: Network, accent: "blue", actions: ["Rules", "TLS", "YAML"] },
  PersistentVolumeClaim: { label: "PVCs", icon: HardDrive, accent: "orange", actions: ["Volume", "Events", "YAML"] },
  PersistentVolume: { label: "PVs", icon: Database, accent: "orange", actions: ["Claim", "Reclaim", "YAML"] },
  StorageClass: { label: "StorageClasses", icon: Database, accent: "orange", actions: ["Provisioner", "YAML"] },
  ConfigMap: { label: "ConfigMaps", icon: Settings2, accent: "green", actions: ["Data", "YAML"] },
  Secret: { label: "Secrets", icon: FileKey2, accent: "orange", actions: ["Keys", "YAML"] },
  ServiceAccount: { label: "ServiceAccounts", icon: Shield, accent: "orange", actions: ["Pods", "Tokens", "YAML"] },
  Role: { label: "Roles", icon: Shield, accent: "orange", actions: ["Rules", "Bindings", "YAML"] },
  RoleBinding: { label: "Bindings", icon: Link2, accent: "orange", actions: ["Role", "Subjects", "YAML"] },
  ClusterRole: { label: "ClusterRoles", icon: Shield, accent: "orange", actions: ["Rules", "Bindings", "YAML"] },
  ClusterRoleBinding: { label: "ClusterBindings", icon: Link2, accent: "orange", actions: ["Role", "Subjects", "YAML"] },
  HelmRelease: { label: "Helm", icon: GalleryVerticalEnd, accent: "blue", actions: ["Values", "Manifest", "Status"] },
  CustomResourceDefinition: { label: "CRDs", icon: Boxes, accent: "blue", actions: ["Versions", "Schema", "YAML"] },
  Event: { label: "Events", icon: Clock3, accent: "orange", actions: ["Involved", "Reason", "YAML"] },
};

export function themeForKind(kind?: string) {
  return (kind && kindThemes[kind]) || fallbackTheme;
}
