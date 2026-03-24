import { greet, fetchData, startCounter } from "@revim/lib";

console.log("=== Sync Function Demo ===");
const syncResult = greet("Bun");
console.log(`greet("Bun") = ${syncResult}`);

console.log("\n=== Async Function Demo ===");
console.time("fetch_data");
const asyncResult = await fetchData(1);
console.timeEnd("fetch_data");
console.log(`fetchData(1) = ${asyncResult}`);

console.log("\n=== Event Emitter Demo ===");
let eventCount = 0;
await new Promise<void>((resolve) => {
  startCounter((err, value) => {
    if (err) {
      console.error("Error:", err);
      return;
    }
    eventCount++;
    console.log(`Event ${eventCount}: ${value}`);
    if (eventCount === 5) {
      resolve();
    }
  });
});

console.log("\n=== All demos complete ===");