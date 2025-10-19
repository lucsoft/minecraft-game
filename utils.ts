export function iteratorToStream<T>(iterator: AsyncIterator<T>) {
  return new ReadableStream<T>({
    async pull(controller) {
      const { value, done } = await iterator.next();

      if (value && !done) {
        controller.enqueue(value);
      }
      if (done) {
        controller.close();
      }
    },
  });
}