import assert from "node:assert/strict";
import test from "node:test";
import {
  compareDiscoveryLeadPriority,
  scoreDiscoveryLeadPriority,
} from "./discovery-candidate-priority";

test("distribution signals rank above bare navigation URLs", () => {
  const download = scoreDiscoveryLeadPriority({
    url: "https://mirror.example/watch/chinna-chinna-aasai-1080p-mkv",
    title: "Chinna Chinna Aasai 1080p WEBRip download",
    text: "full movie download direct link torrent magnet",
    strong: true,
  });
  const nav = scoreDiscoveryLeadPriority({
    url: "https://mirror.example/login",
    title: "Login",
    text: "sign in",
    strong: false,
  });
  assert.ok(download > nav);
});

test("compareDiscoveryLeadPriority orders strong distribution leads first", () => {
  const leads = [
    {
      url: "https://a.example/reviews",
      title: "Review",
      text: "movie review",
      strong: false,
    },
    {
      url: "https://b.example/watch",
      title: "Watch full movie 720p",
      text: "watch online download mkv",
      strong: true,
    },
  ];
  const sorted = [...leads].sort(compareDiscoveryLeadPriority);
  assert.match(sorted[0]!.url, /b\.example/);
});
