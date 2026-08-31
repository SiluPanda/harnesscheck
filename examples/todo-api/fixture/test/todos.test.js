import assert from "node:assert/strict";
import test from "node:test";
import { listTodos } from "../src/todos.js";

test("returns a defensive copy of the todo list", () => {
  const first = listTodos();
  first[0].done = true;
  assert.equal(listTodos()[0].done, false);
});
