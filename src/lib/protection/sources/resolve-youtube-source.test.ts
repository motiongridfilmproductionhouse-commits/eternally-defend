import test from "node:test";
import assert from "node:assert/strict";
import { extractVideoId } from "./resolve-youtube-source.server";

test("extractVideoId: standard watch URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: watch URL with extra query params", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2"),
    "dQw4w9WgXcQ",
  );
});

test("extractVideoId: youtu.be short link", () => {
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: shorts URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: embed URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: bare 11-char video id", () => {
  assert.equal(extractVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: a channel URL is not a video", () => {
  assert.equal(extractVideoId("https://www.youtube.com/@SomeChannel"), null);
  assert.equal(extractVideoId("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"), null);
});

test("extractVideoId: freeform text is not a video", () => {
  assert.equal(extractVideoId("not a url at all"), null);
});
