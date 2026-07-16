import Invoice from '@alias/models/invoice.model'

describe('invoice indexes', () => {
  test('limits billing-period uniqueness to invoices with a string period', () => {
    const index = Invoice.schema.indexes().find(([keys]) =>
      keys.hospital_id === 1 && keys.billing_period === 1,
    )

    expect(index).toBeDefined()
    expect(index?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { billing_period: { $type: 'string' } },
    })
  })
})
