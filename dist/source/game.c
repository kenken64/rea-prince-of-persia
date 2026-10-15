#include "game.h"
#include <stdint.h>
#include "level_data.h"

/* This is independent C gameplay, not a 6502 interpreter. The extracted tiles,
 * room graph, spawns, guards, and button/door event records are exact ROM data.
 * Physics timing, combat AI, sprite-independent collision, potion effects and
 * special-tile behavior below are new, inferred implementations. They are not
 * claims of NES frame accuracy. Scripted original story sequences are absent.
 * Fixed point keeps the native and WebAssembly simulation deterministic. */
#define FP 256
#define PX(n) ((n) * FP)
#define BODY_HALF 5
#define BODY_HEIGHT 36
#define CROUCH_HEIGHT 22
#define FLOOR_Y(row) ((row) * GAME_TILE_HEIGHT + GAME_TILE_FLOOR_OFFSET)
#define MAX_EFFECTS 16

/* The low five tile bits follow the recovered map's tile vocabulary. The
 * complete vocabulary is a compatibility interpretation; floor, pillar, gate,
 * and wall IDs were independently corroborated against the NES editor. */
enum {
    TILE_EMPTY = 0, TILE_FLOOR = 1, TILE_SPIKES = 2, TILE_PILLAR = 3,
    TILE_GATE = 4, TILE_STUCK = 5, TILE_CLOSE = 6, TILE_DOOR_FLOOR = 7,
    TILE_BIG_PILLAR_BOTTOM = 8, TILE_BIG_PILLAR_TOP = 9, TILE_POTION = 10,
    TILE_LOOSE = 11, TILE_DOOR_TOP = 12, TILE_MIRROR = 13,
    TILE_RUBBLE = 14, TILE_OPEN = 15, TILE_EXIT_LEFT = 16,
    TILE_EXIT_RIGHT = 17, TILE_CHOPPER = 18, TILE_TORCH = 19,
    TILE_WALL = 20, TILE_SKELETON = 21, TILE_SWORD = 22,
    TILE_BALCONY = 23, TILE_LATTICE_PILLAR = 24,
    TILE_LATTICE_SUPPORT = 25, TILE_SMALL_LATTICE = 26,
    TILE_LATTICE_LEFT = 27, TILE_LATTICE_RIGHT = 28,
    TILE_TORCH_RUBBLE = 29
};

typedef struct {
    int32_t x, y, vx, vy;
    int room, facing, state, grounded, health, max_health, sword;
    int frame, invulnerable, attack, attack_cooldown, hurt, drink;
    int fall_distance, hang_room, hang_position, hang_side;
    int climb, climb_x, climb_y, climb_room, finish;
} Player;
typedef struct {
    int32_t x, y;
    int active, health, facing, state, attack, cooldown, hurt, skill;
} Guard;
typedef struct { int active, room, type; int32_t x, y, vy; } Effect;

static LevelData campaign[LEVEL_COUNT];
static uint8_t tiles[24][30], gate_open[24][30], gate_target[24][30];
static uint16_t gate_hold[24][30];
static int16_t loose[24][30];
static uint8_t pressed[24][30], spike[24][30];
static Guard guards[24];
static Effect effects[MAX_EFFECTS];
static Player player;
static int current_level, input, previous_input, tick, time_ticks;
static int paused, complete, initialized, last_event, attack_hit;
static uint32_t rng;

static int clamp(int n, int low, int high) { return n < low ? low : n > high ? high : n; }
static int absolute(int n) { return n < 0 ? -n : n; }
static int sign(int n) { return n < 0 ? -1 : n > 0 ? 1 : 0; }
static int floor_div(int n, int d) { return n >= 0 ? n / d : -((-n + d - 1) / d); }
static int to_pixel(int32_t n) { return floor_div(n, FP); }
static int valid_level(int level) { return level >= 0 && level < LEVEL_COUNT; }
static int valid_room(int room) { return room >= 1 && room <= 24; }
static int valid_pos(int pos) { return pos >= 0 && pos < 30; }
static int exists(int room) {
    return valid_room(room) && campaign[current_level].present[room - 1];
}
static uint32_t random_value(void) {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng;
}
static int height(void) { return player.state == GAME_CROUCH ? CROUCH_HEIGHT : BODY_HEIGHT; }
static int link_from(int room, int direction) {
    if (!valid_room(room) || direction < 0 || direction > 3) return 0;
    return campaign[current_level].links[room - 1][direction];
}

/* Lookups cross the exact recovered room links. This is also used for collision
 * against a wall immediately across a screen boundary and for upper ledges. */
static int tile_reference(int room, int col, int row, int *out_room, int *out_pos) {
    int safety;
    for (safety = 0; safety < 5; ++safety) {
        if (!exists(room)) return 0;
        if (col < 0) { room = link_from(room, GAME_LINK_LEFT); col += 10; }
        else if (col >= 10) { room = link_from(room, GAME_LINK_RIGHT); col -= 10; }
        else if (row < 0) { room = link_from(room, GAME_LINK_UP); row += 3; }
        else if (row >= 3) { room = link_from(room, GAME_LINK_DOWN); row -= 3; }
        else { *out_room = room; *out_pos = row * 10 + col; return 1; }
    }
    return 0;
}
static int tile_type(int room, int pos) {
    return valid_room(room) && valid_pos(pos) ? tiles[room - 1][pos] & 31 : TILE_EMPTY;
}
static int supports(int type) {
    return type != TILE_EMPTY && type != TILE_BIG_PILLAR_TOP &&
           type != TILE_DOOR_TOP && type != TILE_LATTICE_SUPPORT &&
           type != TILE_SMALL_LATTICE && type != TILE_LATTICE_LEFT &&
           type != TILE_LATTICE_RIGHT && type != 30 && type != 31;
}
static int support_at(int room, int x, int row, int *out_room, int *out_pos) {
    if (!tile_reference(room, floor_div(x, GAME_TILE_WIDTH), row, out_room, out_pos)) return 0;
    return supports(tile_type(*out_room, *out_pos));
}
static int surface_at(int room, int x, int row, int *out_room, int *out_pos, int *surface) {
    if (!support_at(room, x, row, out_room, out_pos)) return 0;
    *surface = tile_type(*out_room, *out_pos) == TILE_WALL ? row * 64 : FLOOR_Y(row);
    return 1;
}
static int solid_point(int room, int x, int y, int actor_top) {
    int ref_room, ref_pos;
    if (!tile_reference(room, floor_div(x, GAME_TILE_WIDTH), floor_div(y, 64), &ref_room, &ref_pos)) {
        /* Screen sides with no link are walls; an unlinked bottom is lethal. */
        return x < 0 || x >= GAME_WIDTH;
    }
    if (tile_type(ref_room, ref_pos) == TILE_WALL) return 1;
    if (tile_type(ref_room, ref_pos) == TILE_GATE) {
        int surface = FLOOR_Y(floor_div(y, 64));
        /* A raised portcullis leaves clearance above the floor. */
        if (actor_top < surface - gate_open[ref_room - 1][ref_pos] + 2) return 1;
    }
    return 0;
}
static int blocked(int32_t x, int32_t y, int actor_height) {
    int px = to_pixel(x), py = to_pixel(y), side;
    for (side = -1; side <= 1; side += 2) {
        int xx = px + side * BODY_HALF;
        if (solid_point(player.room, xx, py - 2, py - actor_height) ||
            solid_point(player.room, xx, py - actor_height + 2, py - actor_height) ||
            solid_point(player.room, xx, py - actor_height / 2, py - actor_height)) return 1;
    }
    return 0;
}
static void die(void) {
    player.health = 0; player.state = GAME_DEAD; player.grounded = 0;
    player.vx = 0; player.attack = 0; player.frame = 0; last_event = 4;
}
static void damage(int amount, int direction) {
    if (player.state == GAME_DEAD || player.invulnerable || player.state == GAME_FINISH) return;
    player.health -= amount; last_event = 4;
    if (player.health <= 0) { die(); return; }
    player.invulnerable = 70; player.hurt = 18; player.state = GAME_HURT;
    player.vx = PX(direction * 2); player.attack = 0;
}
static void init_tile(int room, int pos) {
    int type = tile_type(room, pos), mod = tiles[room - 1][pos] >> 5;
    /* The NES editor identifies bit 5 as an initially open gate. */
    gate_open[room - 1][pos] = (type == TILE_GATE && mod == 1) ? 64 : 0;
    gate_target[room - 1][pos] = gate_open[room - 1][pos] != 0;
    gate_hold[room - 1][pos] = 0;
    loose[room - 1][pos] = -1; pressed[room - 1][pos] = 0; spike[room - 1][pos] = 0;
}

void game_init(void) {
    int level, room, pos, event;
    for (level = 0; level < LEVEL_COUNT; ++level) {
        for (room = 0; room < 24; ++room) {
            for (pos = 0; pos < 30; ++pos) campaign[level].tiles[room][pos] = levels[level].tiles[room][pos];
            for (pos = 0; pos < 4; ++pos) campaign[level].links[room][pos] = levels[level].links[room][pos];
            campaign[level].guard[room] = levels[level].guard[room];
            campaign[level].present[room] = levels[level].present[room];
        }
        campaign[level].start_room = levels[level].start_room;
        campaign[level].start_pos = levels[level].start_pos;
        campaign[level].start_direction = levels[level].start_direction;
        campaign[level].theme = levels[level].theme;
        campaign[level].event_count = levels[level].event_count;
        for (event = 0; event < LEVEL_MAX_EVENTS; ++event) campaign[level].events[event] = levels[level].events[event];
    }
    initialized = 1; current_level = 0; tick = 0; time_ticks = 60 * 60 * 60;
    input = previous_input = paused = complete = 0; rng = 0x504f5031u;
    player.max_health = 3; player.sword = 0; game_reset();
}
int game_select_level(int level) {
    if (!initialized) game_init();
    if (!valid_level(level)) return 0;
    current_level = level; complete = 0; player.max_health = 3;
    player.sword = level > 0; time_ticks = 60 * 60 * 60; game_reset(); return 1;
}
void game_reset(void) {
    int room, pos, spawn;
    const LevelData *data;
    if (!initialized) { game_init(); return; }
    data = &campaign[current_level];
    for (room = 1; room <= 24; ++room) {
        Guard *g = &guards[room - 1];
        for (pos = 0; pos < 30; ++pos) {
            tiles[room - 1][pos] = data->tiles[room - 1][pos]; init_tile(room, pos);
        }
        pos = data->guard[room - 1] & 31;
        g->active = data->present[room - 1] && pos < 30;
        g->x = PX((pos % 10) * GAME_TILE_WIDTH + GAME_TILE_WIDTH / 2); g->y = PX(FLOOR_Y(pos / 10));
        g->health = 3 + current_level / 4; g->facing = -1;
        g->state = g->attack = g->hurt = 0; g->cooldown = 35;
        g->skill = clamp(current_level / 3, 0, 3);
    }
    for (pos = 0; pos < MAX_EFFECTS; ++pos) effects[pos].active = 0;
    spawn = data->start_pos;
    player.room = data->start_room; player.x = PX((spawn % 10) * GAME_TILE_WIDTH + GAME_TILE_WIDTH / 2);
    player.y = PX(FLOOR_Y(spawn / 10)); player.facing = data->start_direction < 0 ? -1 : 1;
    player.vx = player.vy = 0; player.state = GAME_STAND; player.grounded = 0;
    player.health = player.max_health; player.frame = player.invulnerable = 0;
    player.attack = player.attack_cooldown = player.hurt = player.drink = 0;
    player.fall_distance = player.climb = player.finish = 0; player.hang_room = 0;
    previous_input = input; last_event = attack_hit = 0; complete = 0;
}

int game_trigger(int room, int pos) {
    int i, count = 0, changed = 0;
    const LevelData *data = &campaign[current_level];
    if (!exists(room) || !valid_pos(pos)) return 0;
    for (i = 0; i < data->event_count; ++i) {
        const LevelEvent *e = &data->events[i];
        if (e->source_room == room && e->source_position == pos &&
            exists(e->target_room) && valid_pos(e->target_position)) {
            if (gate_target[e->target_room - 1][e->target_position] != (e->action == 0)) changed = 1;
            gate_target[e->target_room - 1][e->target_position] = e->action == 0;
            gate_hold[e->target_room - 1][e->target_position] = e->action == 0 ? 360 : 0;
            ++count;
        }
    }
    if (changed) last_event = 3;
    pressed[room - 1][pos] = 12;
    return count;
}
static void loose_fall(int room, int pos) {
    int i;
    tiles[room - 1][pos] = TILE_EMPTY; loose[room - 1][pos] = 0;
    last_event = 7;
    for (i = 0; i < MAX_EFFECTS; ++i) if (!effects[i].active) {
        effects[i].active = 1; effects[i].type = TILE_LOOSE; effects[i].room = room;
        effects[i].x = PX((pos % 10) * GAME_TILE_WIDTH + GAME_TILE_WIDTH / 2);
        effects[i].y = PX(FLOOR_Y(pos / 10)); effects[i].vy = 0; break;
    }
}
static void update_tiles(void) {
    int room, pos, i;
    for (room = 1; room <= 24; ++room) for (pos = 0; pos < 30; ++pos) {
        int r = room - 1, type = tile_type(room, pos);
        if (pressed[r][pos]) --pressed[r][pos];
        if (spike[r][pos]) --spike[r][pos];
        if (type == TILE_GATE || type == TILE_EXIT_LEFT || type == TILE_EXIT_RIGHT) {
            if (gate_target[r][pos]) {
                if (gate_open[r][pos] < 64) gate_open[r][pos] = (uint8_t)clamp(gate_open[r][pos] + 2, 0, 64);
                if (gate_hold[r][pos] && --gate_hold[r][pos] == 0 && type == TILE_GATE) gate_target[r][pos] = 0;
            } else if (gate_open[r][pos] && tick % 4 == 0) --gate_open[r][pos];
        }
        if (type == TILE_LOOSE && loose[r][pos] > 0 && --loose[r][pos] == 0) loose_fall(room, pos);
    }
    for (i = 0; i < MAX_EFFECTS; ++i) if (effects[i].active) {
        Effect *e = &effects[i];
        int old_y = to_pixel(e->y), row, rr, pp;
        e->vy = clamp(e->vy + 70, 0, PX(8)); e->y += e->vy;
        for (row = 0; row < 3; ++row) {
            int surface = FLOOR_Y(row);
            if (surface > old_y + 2 && surface <= to_pixel(e->y) &&
                support_at(e->room, to_pixel(e->x), row, &rr, &pp)) {
                if (tile_type(rr, pp) == TILE_LOOSE) loose_fall(rr, pp);
                else if (tile_type(rr, pp) != TILE_WALL) tiles[rr - 1][pp] = TILE_RUBBLE;
                e->active = 0; break;
            }
        }
        if (e->active && player.room == e->room && absolute(to_pixel(player.x - e->x)) < 17 &&
            to_pixel(e->y) >= to_pixel(player.y) - height() && to_pixel(e->y) <= to_pixel(player.y)) damage(2, 0);
        if (to_pixel(e->y) > 196) {
            int next = link_from(e->room, GAME_LINK_DOWN);
            if (exists(next)) { e->room = next; e->y -= PX(192); } else e->active = 0;
        }
    }
}
static void transition_horizontal(void) {
    if (player.x < 0) {
        int next = link_from(player.room, GAME_LINK_LEFT);
        if (exists(next)) { player.room = next; player.x += PX(GAME_WIDTH); }
        else { player.x = PX(BODY_HALF); player.vx = 0; }
    } else if (player.x >= PX(GAME_WIDTH)) {
        int next = link_from(player.room, GAME_LINK_RIGHT);
        if (exists(next)) { player.room = next; player.x -= PX(GAME_WIDTH); }
        else { player.x = PX(GAME_WIDTH - 1 - BODY_HALF); player.vx = 0; }
    }
}
static void transition_vertical(void) {
    if (player.y < 0) {
        int next = link_from(player.room, GAME_LINK_UP);
        if (exists(next)) { player.room = next; player.y += PX(192); }
        else if (player.y < -PX(20)) { player.y = -PX(20); player.vy = 0; }
    } else if (player.y > PX(201)) {
        int next = link_from(player.room, GAME_LINK_DOWN);
        if (exists(next)) { player.room = next; player.y -= PX(192); }
        else die();
    }
}
static int nearby_guard(void) {
    Guard *g = &guards[player.room - 1];
    return g->active && g->health > 0 && absolute(to_pixel(g->y - player.y)) < 18 &&
           absolute(to_pixel(g->x - player.x)) < 84;
}
static int standing_tile(int *room, int *pos) {
    int row, surface;
    for (row = -1; row <= 3; ++row) {
        if (surface_at(player.room, to_pixel(player.x), row, room, pos, &surface) &&
            absolute(to_pixel(player.y) - surface) <= 3) return 1;
    }
    return 0;
}
static void touch_floor(int room, int pos, int impact) {
    int type = tile_type(room, pos);
    if (type == TILE_LOOSE && loose[room - 1][pos] < 0) loose[room - 1][pos] = 30;
    if (type == TILE_OPEN || type == TILE_CLOSE || type == TILE_STUCK) game_trigger(room, pos);
    if (type == TILE_SPIKES) {
        spike[room - 1][pos] = 90;
        if (impact > 28 || !(input & GAME_INPUT_ACTION) || absolute(player.vx) > 220) die();
    }
}
static int try_grab(void) {
    int row, side = player.facing, edge_x = to_pixel(player.x) + side * 11;
    int hands = to_pixel(player.y) - BODY_HEIGHT + 3;
    if (!(input & (GAME_INPUT_ACTION | GAME_INPUT_UP)) || (input & GAME_INPUT_DOWN) || player.vy < -PX(2)) return 0;
    for (row = -1; row <= 3; ++row) {
        int surface = FLOOR_Y(row), rr, pp, air_room, air_pos;
        if (absolute(hands - surface) > 9 ||
            !support_at(player.room, edge_x, row, &rr, &pp) ||
            tile_type(rr, pp) == TILE_WALL || tile_type(rr, pp) == TILE_SPIKES) continue;
        if (support_at(player.room, edge_x - side * GAME_TILE_WIDTH, row, &air_room, &air_pos)) continue;
        {
            int edge = side > 0 ? floor_div(edge_x, GAME_TILE_WIDTH) * GAME_TILE_WIDTH : (floor_div(edge_x, GAME_TILE_WIDTH) + 1) * GAME_TILE_WIDTH;
            if (absolute(to_pixel(player.x) - edge) > 17) continue;
            player.x = PX(edge - side * 6); player.y = PX(surface + BODY_HEIGHT - 3);
            player.vx = player.vy = 0; player.state = GAME_HANG; player.grounded = 0;
            player.hang_room = rr; player.hang_position = pp; player.hang_side = side;
            player.fall_distance = 0; player.frame = 0; return 1;
        }
    }
    return 0;
}
static void update_hanging(int edges) {
    if (input & GAME_INPUT_DOWN) {
        player.state = GAME_FALL; player.vy = FP; player.y += PX(6);
        player.hang_room = 0; return;
    }
    if (edges & (GAME_INPUT_UP | GAME_INPUT_JUMP)) {
        player.state = GAME_CLIMB; player.climb = 24;
        player.climb_room = player.hang_room;
        player.climb_x = (player.hang_position % 10) * GAME_TILE_WIDTH + GAME_TILE_WIDTH / 2;
        player.climb_y = FLOOR_Y(player.hang_position / 10);
        player.frame = 0;
    }
}
static void update_climbing(void) {
    /* The actor interpolates toward the ledge in the same room. A ledge across
     * a room boundary changes room at completion, avoiding a screen-wide tween. */
    if (player.room == player.climb_room && player.climb > 0) {
        player.x += (PX(player.climb_x) - player.x) / player.climb;
        player.y += (PX(player.climb_y) - player.y) / player.climb;
    }
    if (--player.climb <= 0) {
        player.room = player.climb_room; player.x = PX(player.climb_x); player.y = PX(player.climb_y);
        player.state = GAME_STAND; player.grounded = 1; player.vx = player.vy = 0;
        player.hang_room = 0;
    }
}
static void interact(int edges) {
    int rr, pp, type, mod;
    if (!player.grounded || !(edges & (GAME_INPUT_DOWN | GAME_INPUT_ACTION | GAME_INPUT_UP))) return;
    if (!standing_tile(&rr, &pp)) return;
    type = tile_type(rr, pp); mod = tiles[rr - 1][pp] >> 5;
    if ((edges & (GAME_INPUT_DOWN | GAME_INPUT_ACTION)) && type == TILE_SWORD) {
        player.sword = 1; tiles[rr - 1][pp] = TILE_FLOOR;
        player.drink = 20; player.state = GAME_DRINK; last_event = 6;
    } else if ((edges & (GAME_INPUT_DOWN | GAME_INPUT_ACTION)) && type == TILE_POTION) {
        tiles[rr - 1][pp] = TILE_FLOOR; player.drink = 35; player.state = GAME_DRINK;
        /* ROM modifiers 1=small red,2=large red; 3=poison is an inferred effect. */
        if (mod == 2) { player.max_health = clamp(player.max_health + 1, 1, 10); player.health = player.max_health; }
        else if (mod == 3) damage(1, 0);
        else player.health = clamp(player.health + 1, 0, player.max_health);
        last_event = 6;
    } else if ((edges & GAME_INPUT_UP) && (type == TILE_EXIT_LEFT || type == TILE_EXIT_RIGHT)) {
        int opening = gate_open[rr - 1][pp];
        if (type == TILE_EXIT_RIGHT && pp % 10 > 0 && tile_type(rr, pp - 1) == TILE_EXIT_LEFT)
            opening = gate_open[rr - 1][pp - 1];
        if (opening >= 36 && !nearby_guard()) {
            player.state = GAME_FINISH; player.finish = 90; player.vx = player.vy = 0; last_event = 8;
        }
    }
}
static void update_player(int edges) {
    int direction = ((input & GAME_INPUT_RIGHT) != 0) - ((input & GAME_INPUT_LEFT) != 0);
    int combat, rr, pp, old_grounded = player.grounded;
    int32_t old_y;
    if (player.state == GAME_DEAD) {
        player.vy = clamp(player.vy + 72, -PX(8), PX(8));
        /* Bodies settle on the current floor instead of falling through it. */
        if (!player.grounded) {
            int row;
            old_y = player.y; player.y += player.vy;
            for (row = 0; row < 3; ++row) {
                int surface;
                if (surface_at(player.room, to_pixel(player.x), row, &rr, &pp, &surface) &&
                    old_y <= PX(surface) && player.y >= PX(surface)) {
                    player.y = PX(surface); player.vy = 0; player.grounded = 1; break;
                }
            }
            if (player.y > PX(GAME_HEIGHT + 48)) player.y = PX(GAME_HEIGHT + 48);
        }
        return;
    }
    if (player.state == GAME_FINISH) {
        if (player.finish > 0 && --player.finish == 0) {
            if (current_level + 1 < LEVEL_COUNT) {
                ++current_level; player.sword = 1; game_reset();
            } else complete = 1;
        }
        return;
    }
    if (player.state == GAME_HANG) { update_hanging(edges); return; }
    if (player.state == GAME_CLIMB) { update_climbing(); return; }
    if (player.invulnerable) --player.invulnerable;
    if (player.attack_cooldown) --player.attack_cooldown;
    if (player.hurt) --player.hurt;
    if (player.drink) { --player.drink; direction = 0; }
    combat = player.sword && nearby_guard();
    if (player.grounded) {
        if (!standing_tile(&rr, &pp)) player.grounded = 0;
        else touch_floor(rr, pp, 0);
    }
    if (player.state == GAME_DEAD) return;
    /* Resolve the door/pickup before Up becomes a jump. */
    interact(edges);
    if (player.state == GAME_FINISH) return;
    if (player.drink) direction = 0;
    if (direction && !player.attack && !player.hurt && !player.drink) player.facing = direction;
    if (player.grounded && !player.hurt && !player.drink) {
        int crouching = (input & GAME_INPUT_DOWN) != 0;
        int crouch_blocked = player.state == GAME_CROUCH && blocked(player.x, player.y, BODY_HEIGHT);
        if (crouching || crouch_blocked) player.state = GAME_CROUCH;
        else if (!player.attack) player.state = combat ? GAME_SWORD : direction ? GAME_RUN : GAME_STAND;
        if (!crouching && !crouch_blocked && !combat &&
            (edges & (GAME_INPUT_JUMP | GAME_INPUT_UP))) {
            player.vy = -1434; player.grounded = 0; player.state = GAME_JUMP;
            player.fall_distance = 0; last_event = 2;
            if (direction && absolute(player.vx) < PX(2)) player.vx = direction * PX(2);
        }
    }
    if (combat && player.grounded && (edges & GAME_INPUT_ACTION) && !player.attack_cooldown && !player.hurt) {
        player.attack = 18; player.attack_cooldown = 30; player.state = GAME_ATTACK; attack_hit = 0;
    }
    if (player.attack) { --player.attack; player.state = GAME_ATTACK; direction = 0; }
    if (!player.hurt) {
        int speed = player.state == GAME_CROUCH ? 140 : combat ? 185 : (input & GAME_INPUT_ACTION) ? 190 : 675;
        int acceleration = player.grounded ? 46 : 15;
        if (direction && !player.drink && !player.attack) {
            int target = direction * speed;
            if (player.vx < target) player.vx = clamp(player.vx + acceleration, -speed, target);
            else if (player.vx > target) player.vx = clamp(player.vx - acceleration, target, speed);
        } else if (player.grounded) {
            if (absolute(player.vx) <= 80) player.vx = 0;
            else player.vx -= sign(player.vx) * 80;
        }
    }
    if (player.vx) {
        int32_t desired = player.x + player.vx;
        if (!blocked(desired, player.y, height())) player.x = desired;
        else {
            int32_t increment = sign(player.vx) * FP;
            while (absolute(desired - player.x) > FP && !blocked(player.x + increment, player.y, height())) player.x += increment;
            player.vx = 0;
        }
    }
    transition_horizontal();
    old_y = player.y;
    if (!player.grounded) {
        int row;
        player.vy = clamp(player.vy + 72, -PX(8), PX(8)); player.y += player.vy;
        if (player.vy >= 0) {
            player.fall_distance += player.y - old_y;
            for (row = -1; row <= 3; ++row) {
                int side, landed = 0, surface_pixel = 0;
                int32_t surface;
                for (side = -1; side <= 1; side += 2) {
                    if (surface_at(player.room, to_pixel(player.x) + side * 3, row, &rr, &pp, &surface_pixel) &&
                        old_y <= PX(surface_pixel) && player.y >= PX(surface_pixel)) { landed = 1; break; }
                }
                surface = PX(surface_pixel);
                if (landed) {
                    int distance = to_pixel(player.fall_distance);
                    player.y = surface; player.vy = 0; player.grounded = 1;
                    player.state = direction ? GAME_RUN : GAME_STAND; player.fall_distance = 0;
                    if (distance >= 180) die();
                    else if (distance >= 112) damage(1, -player.facing);
                    touch_floor(rr, pp, distance); last_event = player.state == GAME_DEAD ? 4 : 1;
                    break;
                }
            }
        } else {
            /* A floor is a ceiling from below; upper ledges remain grabbable
             * at their open edge. */
            for (row = -1; row <= 2; ++row) {
                int bottom = FLOOR_Y(row) + 8;
                if (to_pixel(old_y) - height() >= bottom && to_pixel(player.y) - height() < bottom &&
                    support_at(player.room, to_pixel(player.x), row, &rr, &pp)) {
                    player.y = PX(bottom + height()); player.vy = 0; break;
                }
            }
        }
        if (!player.grounded && player.state != GAME_DEAD) {
            player.state = player.vy < 0 ? GAME_JUMP : GAME_FALL;
            if (try_grab()) return;
        }
    }
    if (old_grounded && player.grounded && !standing_tile(&rr, &pp)) {
        player.grounded = 0; player.state = GAME_FALL; player.fall_distance = 0;
    }
    transition_vertical();
    if (player.hurt && player.state != GAME_DEAD) player.state = GAME_HURT;
    else if (player.drink && player.state != GAME_DEAD) player.state = GAME_DRINK;
}
static void update_guard(void) {
    Guard *g = &guards[player.room - 1];
    int distance, direction, rr, pp;
    if (!g->active || g->health <= 0) return;
    if (g->cooldown) --g->cooldown;
    if (g->hurt) { --g->hurt; g->state = 4; return; }
    distance = absolute(to_pixel(g->x - player.x));
    direction = g->x < player.x ? 1 : -1; g->facing = direction;
    if (player.state == GAME_DEAD || player.state == GAME_FINISH ||
        absolute(to_pixel(g->y - player.y)) > 20 || distance > 150) { g->state = 0; return; }
    if (player.attack == 12 && !attack_hit && distance < 38 &&
        player.facing == -direction && player.sword) {
        attack_hit = 1;
        if (g->attack > 0 || g->cooldown > 24 || random_value() % 5u >= (uint32_t)g->skill) {
            --g->health; g->hurt = 20; g->attack = 0; g->state = 4; last_event = 5;
            if (g->health <= 0) { g->state = 5; g->active = 0; }
        } else { g->state = 3; g->cooldown = 30; last_event = 5; }
        return;
    }
    if (g->attack > 0) {
        --g->attack; g->state = 2;
        if (g->attack == 8 && distance < 35) {
            if (player.sword && player.facing == -direction && (input & GAME_INPUT_UP) && !player.attack) {
                g->hurt = 12; g->state = 3; last_event = 5;
            } else damage(1, direction);
        }
        return;
    }
    if (distance < 30) {
        g->state = 0;
        if (!g->cooldown) { g->attack = 24; g->cooldown = 70 - g->skill * 8; g->state = 2; }
    } else {
        int32_t next_x = g->x + direction * (player.sword ? 130 : 190);
        int row = floor_div(to_pixel(g->y) - 56 + 3, 64);
        if (support_at(player.room, to_pixel(next_x) + direction * 10, row, &rr, &pp) &&
            tile_type(rr, pp) != TILE_SPIKES && tile_type(rr, pp) != TILE_WALL &&
            (tile_type(rr, pp) != TILE_GATE || gate_open[rr - 1][pp] >= BODY_HEIGHT + 2) &&
            to_pixel(next_x) >= 8 && to_pixel(next_x) < GAME_WIDTH - 8) { g->x = next_x; g->state = 1; }
        else g->state = 0;
    }
}
static void update_hazards(void) {
    int row = floor_div(to_pixel(player.y) - 56 + 8, 64), col, rr, pp;
    if (player.state == GAME_DEAD || player.state == GAME_FINISH) return;
    for (col = floor_div(to_pixel(player.x) - 7, GAME_TILE_WIDTH); col <= floor_div(to_pixel(player.x) + 7, GAME_TILE_WIDTH); ++col) {
        if (!tile_reference(player.room, col, row, &rr, &pp)) continue;
        if (tile_type(rr, pp) == TILE_CHOPPER) {
            int phase = (tick + pp * 7) % 96;
            if (phase >= 12 && phase < 21 && absolute(to_pixel(player.x) - (col * GAME_TILE_WIDTH + GAME_TILE_WIDTH / 2)) <= 10 &&
                to_pixel(player.y) > FLOOR_Y(row) - 42) die();
        } else if (tile_type(rr, pp) == TILE_SPIKES && player.grounded &&
                   absolute(to_pixel(player.x) - (col * GAME_TILE_WIDTH + GAME_TILE_WIDTH / 2)) < 12) {
            spike[rr - 1][pp] = 90;
            if (!(input & GAME_INPUT_ACTION) || absolute(player.vx) > 220) die();
        }
    }
}
void game_set_input(int mask) { input = mask & 127; }
void game_set_paused(int value) { paused = value != 0; }
void game_step(void) {
    int edges;
    if (!initialized) game_init();
    edges = input & ~previous_input; previous_input = input;
    if (edges & GAME_INPUT_RESTART) { game_reset(); return; }
    if (paused || complete) return;
    ++tick; ++player.frame; last_event = 0;
    if (time_ticks > 0 && player.state != GAME_DEAD && player.state != GAME_FINISH) --time_ticks;
    if (time_ticks <= 0 && player.state != GAME_DEAD) die();
    update_tiles(); update_player(edges); update_guard(); update_hazards();
}
void game_update(int ticks) { int i; for (i = 0; i < clamp(ticks, 0, 600); ++i) game_step(); }

int game_get_level_count(void) { return LEVEL_COUNT; }
int game_get_level(void) { return current_level; }
int game_get_room(void) { return player.room; }
int game_get_tick(void) { return tick; }
int game_get_flags(void) {
    return (player.state == GAME_DEAD ? GAME_FLAG_DEAD : 0) |
           (player.state == GAME_FINISH ? GAME_FLAG_LEVEL_COMPLETE : 0) |
           (complete ? GAME_FLAG_COMPLETE : 0) | (paused ? GAME_FLAG_PAUSED : 0);
}
int game_get_time_left(void) { return (time_ticks + 59) / 60; }
int game_get_health(void) { return player.health; }
int game_get_max_health(void) { return player.max_health; }
int game_get_has_sword(void) { return player.sword; }
int game_get_player_x(void) { return to_pixel(player.x); }
int game_get_player_y(void) { return to_pixel(player.y); }
int game_get_player_vx(void) { return player.vx; }
int game_get_player_vy(void) { return player.vy; }
int game_get_player_facing(void) { return player.facing; }
int game_get_player_state(void) { return player.state; }
int game_get_player_grounded(void) { return player.grounded; }
int game_get_player_height(void) { return height(); }
int game_get_player_animation(void) { return player.frame; }
int game_get_player_attack_frame(void) { return player.attack ? 18 - player.attack : -1; }
int game_get_player_invulnerable(void) { return player.invulnerable; }
int game_get_room_present(int room) { return exists(room); }
int game_get_link(int room, int direction) { return link_from(room, direction); }
int game_get_tile(int room, int pos) { return valid_room(room) && valid_pos(pos) ? tiles[room - 1][pos] : 0; }
int game_get_initial_tile(int room, int pos) { return valid_room(room) && valid_pos(pos) ? campaign[current_level].tiles[room - 1][pos] : 0; }
int game_get_gate(int room, int pos) { return valid_room(room) && valid_pos(pos) ? gate_open[room - 1][pos] : 0; }
int game_get_tile_state(int room, int pos) {
    int type;
    if (!valid_room(room) || !valid_pos(pos)) return 0;
    type = tile_type(room, pos);
    if (type == TILE_LOOSE) return loose[room - 1][pos] < 0 ? 0 : 31 - loose[room - 1][pos];
    if (type == TILE_SPIKES) return spike[room - 1][pos];
    if (type == TILE_CHOPPER) return (tick + pos * 7) % 96;
    return pressed[room - 1][pos];
}
int game_get_guard_active(int room) { return valid_room(room) ? guards[room - 1].active : 0; }
int game_get_guard_x(int room) { return valid_room(room) ? to_pixel(guards[room - 1].x) : 0; }
int game_get_guard_y(int room) { return valid_room(room) ? to_pixel(guards[room - 1].y) : 0; }
int game_get_guard_health(int room) { return valid_room(room) ? guards[room - 1].health : 0; }
int game_get_guard_facing(int room) { return valid_room(room) ? guards[room - 1].facing : 1; }
int game_get_guard_state(int room) { return valid_room(room) ? guards[room - 1].state : 0; }
int game_get_guard_raw(int room) { return valid_room(room) ? campaign[current_level].guard[room - 1] : 255; }
int game_get_event_count(void) { return campaign[current_level].event_count; }
int game_get_event_value(int event, int field) {
    const LevelEvent *e;
    if (event < 0 || event >= campaign[current_level].event_count) return -1;
    e = &campaign[current_level].events[event];
    switch (field) { case 0: return e->source_room; case 1: return e->source_position;
        case 2: return e->action; case 3: return e->target_room; case 4: return e->target_position; default: return -1; }
}
int game_get_theme(void) { return campaign[current_level].theme; }
int game_get_start_room(void) { return campaign[current_level].start_room; }
int game_get_start_position(void) { return campaign[current_level].start_pos; }
int game_get_effect_count(void) { return MAX_EFFECTS; }
int game_get_effect_value(int effect, int field) {
    Effect *e;
    if (effect < 0 || effect >= MAX_EFFECTS) return 0;
    e = &effects[effect];
    switch (field) { case 0: return e->active; case 1: return e->room; case 2: return to_pixel(e->x);
        case 3: return to_pixel(e->y); case 4: return e->type; default: return 0; }
}
int game_get_last_event(void) { return last_event; }

int game_edit_tile(int level, int room, int pos, int raw) {
    if (!valid_level(level) || !valid_room(room) || !valid_pos(pos) || raw < 0 || raw > 255) return 0;
    campaign[level].tiles[room - 1][pos] = (uint8_t)raw; campaign[level].present[room - 1] = 1;
    if (level == current_level) { tiles[room - 1][pos] = (uint8_t)raw; init_tile(room, pos); }
    return 1;
}
int game_edit_link(int level, int room, int direction, int target) {
    if (!valid_level(level) || !valid_room(room) || direction < 0 || direction > 3 || target < 0 || target > 24) return 0;
    campaign[level].links[room - 1][direction] = (uint8_t)target; return 1;
}
int game_edit_spawn(int level, int room, int pos, int facing) {
    if (!valid_level(level) || !valid_room(room) || !valid_pos(pos)) return 0;
    campaign[level].start_room = (uint8_t)room; campaign[level].start_pos = (uint8_t)pos;
    campaign[level].start_direction = facing < 0 ? -1 : 1; return 1;
}
int game_edit_guard(int level, int room, int raw) {
    if (!valid_level(level) || !valid_room(room) || raw < 0 || raw > 255) return 0;
    campaign[level].guard[room - 1] = (uint8_t)raw; return 1;
}
int game_edit_event(int level, int index, int source_room, int source_pos, int action, int target_room, int target_pos) {
    LevelEvent *e;
    if (!valid_level(level) || index < 0 || index >= LEVEL_MAX_EVENTS || !valid_room(source_room) ||
        !valid_pos(source_pos) || !valid_room(target_room) || !valid_pos(target_pos) || action < 0 || action > 1) return 0;
    e = &campaign[level].events[index]; e->source_room = (uint8_t)source_room;
    e->source_position = (uint8_t)source_pos; e->action = (uint8_t)action;
    e->target_room = (uint8_t)target_room; e->target_position = (uint8_t)target_pos;
    if (campaign[level].event_count <= index) campaign[level].event_count = (uint8_t)(index + 1);
    return 1;
}
int game_set_player(int room, int x, int y, int facing) {
    if (!exists(room) || x < -GAME_TILE_WIDTH || x > GAME_WIDTH + GAME_TILE_WIDTH || y < -64 || y > 256) return 0;
    player.room = room; player.x = PX(x); player.y = PX(y); player.facing = facing < 0 ? -1 : 1;
    player.vx = player.vy = 0; player.state = GAME_STAND; player.grounded = 0;
    player.fall_distance = player.hurt = player.invulnerable = player.attack = player.drink = 0;
    return 1;
}
void game_set_health(int health) { player.health = clamp(health, 0, player.max_health); if (!player.health) die(); }
void game_set_has_sword(int value) { player.sword = value != 0; }
