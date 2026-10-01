# Spatial AI: Delivery-Platform Semantic Model

How does a platform allocate limited courier capacity across orders with different revenue and fulfillment times?

## Central Diagram

```text
                         CUSTOMER
                            │
                         creates
                            ↓
RESTAURANT ── prepares ──→ ORDER ←── evaluates / assigns ── PLATFORM
                            ↑
                   picks up / delivers
                            │
                         COURIER
```

ORDER is the central object; CUSTOMER, RESTAURANT, COURIER, and PLATFORM are the connected agents. The platform assigns a courier to an order and updates its delivery-time estimate.

## Entities and Attributes

| Entity | Attributes |
|---|---|
| **ORDER** | revenue; creation time; status; total delivery time |
| **CUSTOMER** | location; order time; selected restaurant |
| **RESTAURANT** | location; preparation time; active orders; production capacity |
| **COURIER** | location; availability; current assignment; travel time |
| **PLATFORM** | available couriers; pending orders; allocation logic; delivery-time estimate |

## Relationships

- CUSTOMER → creates → ORDER
- RESTAURANT → prepares → ORDER
- PLATFORM → evaluates → ORDER
- PLATFORM → assigns courier to → ORDER
- PLATFORM → updates delivery-time estimate for → ORDER
- COURIER → picks up / delivers → ORDER

## Rules

1. Courier capacity is limited.
2. A courier can only serve a limited number of orders at one time.
3. An order cannot be picked up before it is ready.
4. Restaurant preparation time affects when an order becomes available for delivery.
5. Platform assignment affects how long an order waits before pickup.
6. Order revenue **may influence** platform allocation priority. This is a simulation hypothesis, not a verified claim about a real platform.
7. Total delivery time is not fixed; it changes with restaurant preparation, courier availability, travel time, and platform allocation.

## Actions

| Entity | Actions |
|---|---|
| **CUSTOMER** | creates order |
| **RESTAURANT** | accepts order; prepares order; marks order ready |
| **PLATFORM** | evaluates pending orders; estimates delivery time; assigns courier; updates order priority |
| **COURIER** | accepts assignment; travels to restaurant; picks up order; delivers order |
| **ORDER** | changes status: pending → preparing → ready → assigned → picked_up → delivered |

The ORDER sequence is a simplified simulation flow; ORDER changes state rather than acting independently.
