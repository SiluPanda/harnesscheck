const todos = [{ id: 1, title: "Ship the agent eval", done: false }];

export function listTodos() {
  return todos.map((todo) => ({ ...todo }));
}
