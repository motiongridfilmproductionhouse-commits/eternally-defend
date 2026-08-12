import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Copyright, Loader2, Plus, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABELS,
  createCampaign,
  listCampaigns,
  setCampaignStatus,
  type CampaignType,
} from "@/lib/campaigns/campaigns.functions";

function splitLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function CampaignsWorkspace() {
  const queryClient = useQueryClient();
  const fetchCampaigns = useServerFn(listCampaigns);
  const changeStatus = useServerFn(setCampaignStatus);
  const [tab, setTab] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");

  const campaignsQuery = useQuery({
    queryKey: ["celebrity-campaigns"],
    queryFn: () => fetchCampaigns(),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: "ACTIVE" | "ARCHIVED" }) =>
      changeStatus({ data: vars }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["celebrity-campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const campaigns = (campaignsQuery.data?.campaigns ?? []).filter((c) => c.status === tab);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Copyright &amp; Campaign Protection
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Protect each release as a campaign. Add your official assets once — we watch for
            unauthorized reposts, copied media, fake promo accounts and misleading edits.
          </p>
        </div>
        <NewCampaignDialog />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "ACTIVE" | "ARCHIVED")}>
        <TabsList>
          <TabsTrigger value="ACTIVE">Active</TabsTrigger>
          <TabsTrigger value="ARCHIVED">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      {campaignsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="card-surface">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Copyright className="size-6" />
            </div>
            <div className="text-sm font-semibold">
              {tab === "ACTIVE" ? "No active campaigns yet" : "No archived campaigns"}
            </div>
            <p className="max-w-md text-xs text-muted-foreground">
              Create a campaign for your next film, song, advertisement or photoshoot and we will
              start protecting its official assets.
            </p>
            {tab === "ACTIVE" && <NewCampaignDialog />}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <Card key={c.id} className="card-surface">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>
                    {c.status === "ACTIVE" ? "Protected" : "Archived"}
                  </Badge>
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {CAMPAIGN_TYPE_LABELS[(c.campaign_type as CampaignType) ?? "other"] ?? "Other"}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-2">
                  <Stat label="Assets" value={c.assets.length} />
                  <Stat label="Official URLs" value={c.official_urls.length} />
                  <Stat label="Hashtags" value={c.hashtags.length} />
                </div>
                {c.status === "ACTIVE" && c.monitoring_started_at && (
                  <div className="flex items-center gap-1.5 text-primary">
                    <ShieldCheck className="size-3.5" /> Monitoring since{" "}
                    {new Date(c.monitoring_started_at).toLocaleDateString()}
                  </div>
                )}
                {c.notes && <p className="line-clamp-2">{c.notes}</p>}
                <div className="flex gap-2 pt-1">
                  {c.status === "ACTIVE" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: c.id, status: "ARCHIVED" })}
                    >
                      <Archive className="mr-1.5 size-3.5" /> Archive
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ id: c.id, status: "ACTIVE" })}
                    >
                      <RotateCcw className="mr-1.5 size-3.5" /> Resume protection
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 px-2.5 py-1.5">
      <div className="text-sm font-semibold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}

export function NewCampaignDialog({ trigger }: { trigger?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const create = useServerFn(createCampaign);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("film");
  const [urls, setUrls] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [notes, setNotes] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [approvedAccounts, setApprovedAccounts] = useState("");
  const [approvedMedia, setApprovedMedia] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      setUploading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        const uploaded: { asset_kind: "photo" | "video"; title: string; storage_path: string }[] =
          [];
        for (const file of files) {
          if (!uid) break;
          const path = `${uid}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
          const { error } = await supabase.storage.from("campaign-assets").upload(path, file);
          if (error) throw new Error(error.message);
          uploaded.push({
            asset_kind: file.type.startsWith("video") ? "video" : "photo",
            title: file.name,
            storage_path: path,
          });
        }
        const officialUrls = splitLines(urls);
        return create({
          data: {
            name,
            campaign_type: type,
            notes: notes || undefined,
            hashtags: splitLines(hashtags).map((h) => (h.startsWith("#") ? h : `#${h}`)),
            official_urls: officialUrls,
            assets: [
              ...uploaded,
              ...officialUrls.map((u) => ({ asset_kind: "link" as const, source_url: u })),
            ],
            start_monitoring: true,
          },
        });
      } finally {
        setUploading(false);
      }
    },
    onSuccess: async () => {
      toast.success("Campaign protection started");
      setOpen(false);
      setName("");
      setUrls("");
      setHashtags("");
      setNotes("");
      setFiles([]);
      await queryClient.invalidateQueries({ queryKey: ["celebrity-campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = mutation.isPending || uploading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-1.5 size-4" /> New Campaign
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
          <DialogDescription>
            Tell us what you are releasing and share the official assets. No technical setup
            required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input
              id="campaign-name"
              placeholder="New Movie Launch"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Campaign type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CAMPAIGN_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-files">Official assets</Label>
            <Input
              id="campaign-files"
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <p className="text-[11px] text-muted-foreground">
              Posters, promotional photos, trailer or video clips.
              {files.length > 0 && ` ${files.length} file(s) selected.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-urls">Official URLs</Label>
            <Textarea
              id="campaign-urls"
              rows={3}
              placeholder={"https://youtube.com/watch?v=...\nhttps://instagram.com/p/..."}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-tags">Campaign hashtags</Label>
            <Input
              id="campaign-tags"
              placeholder="#NewMovieLaunch, #OfficialTrailer"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-notes">Notes (optional)</Label>
            <Textarea
              id="campaign-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={busy || name.trim().length < 2}>
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 size-4" />
            )}
            Start Protection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
