/// <reference path="../../pb_data/types.d.ts" />
// P2 step 11: help (FR-12.11). The help pages are part of the app (they work offline); short training videos
// are stored on the hub (help_videos), added by people who manage settings, watched by everyone signed in.
// Down drops exactly what up adds.

const ACTIVE = '@request.auth.collectionName = "users" && @request.auth.status = "active" && @request.auth.deleted_at = ""';

migrate((app) => {
  app.save(new Collection({ type: "base", name: "help_videos", listRule: ACTIVE, viewRule: ACTIVE, createRule: ACTIVE, updateRule: ACTIVE, deleteRule: null,
    fields: [
      { name: "title", type: "text", required: true, max: 120 },
      { name: "topic", type: "text", max: 40 },                       // a help page id, e.g. "sell"
      { name: "description", type: "text", max: 1000 },
      { name: "video", type: "file", required: true, maxSelect: 1, maxSize: 157286400, mimeTypes: ["video/mp4", "video/webm", "video/quicktime"] },
      { name: "minutes", type: "number", min: 0, max: 120 },
      { name: "sort", type: "number", onlyInt: true },
      { name: "archived", type: "bool" },
      { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      { name: "created_by", type: "text", max: 64 },
      { name: "updated_by", type: "text", max: 64 },
      { name: "device_id", type: "text", max: 64 },
      { name: "deleted_at", type: "date" },
    ] }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("help_videos"));
});
