#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include "../src/game.h"

static void steps(int input, int count) {
    game_set_input(input); game_update(count);
}
static void arena(void) {
    int room, pos, direction;
    game_init();
    for (room = 1; room <= 24; ++room) {
        for (pos = 0; pos < 30; ++pos) assert(game_edit_tile(0, room, pos, pos >= 20 ? 1 : 0));
        for (direction = 0; direction < 4; ++direction) assert(game_edit_link(0, room, direction, 0));
        assert(game_edit_guard(0, room, 255));
    }
    game_edit_spawn(0, 1, 23, 1); game_reset(); steps(0, 2);
    assert(game_get_player_grounded());
}
static void test_campaign_and_bounds(void) {
    int level, room, direction, present = 0, events = 0;
    game_init();
    assert(game_get_level_count() == 14);
    for (level = 0; level < 14; ++level) {
        assert(game_select_level(level));
        assert(game_get_room() == game_get_start_room());
        assert(game_get_player_x() == game_get_start_position() % 10 * 24 + 12);
        assert(game_get_player_y() == game_get_start_position() / 10 * 64 + 56);
        for (room = 1; room <= 24; ++room) {
            present += game_get_room_present(room) != 0;
            for (direction = 0; direction < 4; ++direction) {
                int target = game_get_link(room, direction);
                assert(target >= 0 && target <= 24);
            }
        }
        events += game_get_event_count();
    }
    assert(present == 271); assert(events == 146);
    assert(!game_select_level(-1)); assert(!game_select_level(14));
    assert(!game_edit_tile(14, 1, 0, 1)); assert(!game_edit_tile(0, 0, 0, 1));
    assert(!game_edit_tile(0, 25, 0, 1)); assert(!game_edit_tile(0, 1, 30, 1));
    assert(!game_edit_tile(0, 1, 0, 256)); assert(!game_edit_link(0, 1, 4, 0));
    assert(game_get_tile(0, 0) == 0); assert(game_get_event_value(-1, 0) == -1);
}
static void test_floor_wall_and_jump(void) {
    int min_y = 184, i;
    arena(); game_edit_tile(0, 1, 26, 20);
    assert(game_set_player(1, 100, 184, 1)); steps(GAME_INPUT_RIGHT, 60);
    assert(game_get_player_x() <= 139); assert(game_get_player_y() == 184);
    assert(game_get_health() == 3);
    arena(); game_edit_tile(0, 1, 24, 20); game_set_player(1, 108, 90, 1); steps(0, 25);
    assert(game_get_player_y() == 128); assert(game_get_player_grounded());
    arena(); game_edit_tile(0, 1, 24, 0); game_set_player(1, 84, 184, 1); steps(0, 2);
    steps(GAME_INPUT_RIGHT | GAME_INPUT_JUMP, 1);
    assert(game_get_player_vy() < 0); assert(!game_get_player_grounded());
    for (i = 0; i < 44; ++i) {
        steps(GAME_INPUT_RIGHT, 1);
        if (game_get_player_y() < min_y) min_y = game_get_player_y();
    }
    assert(min_y < 145); assert(game_get_player_x() > 120);
    assert(game_get_player_grounded()); assert(game_get_health() == 3);
}
static void test_room_links(void) {
    arena(); game_edit_link(0, 1, GAME_LINK_RIGHT, 2); game_edit_link(0, 2, GAME_LINK_LEFT, 1);
    game_set_player(1, 230, 184, 1); steps(GAME_INPUT_RIGHT, 20);
    assert(game_get_room() == 2); assert(game_get_player_x() < 60);
    steps(GAME_INPUT_LEFT, 45); assert(game_get_room() == 1);
    arena(); game_edit_link(0, 1, GAME_LINK_DOWN, 2);
    game_edit_tile(0, 1, 23, 0); game_set_player(1, 84, 184, 1); steps(0, 24);
    assert(game_get_room() == 2); assert(game_get_player_y() < 100);
    arena(); game_edit_tile(0, 1, 23, 0); game_set_player(1, 84, 184, 1); steps(0, 30);
    assert(game_get_flags() & GAME_FLAG_DEAD);
}
static void test_hazards_and_fall_damage(void) {
    arena(); game_edit_tile(0, 1, 23, 2); game_set_player(1, 84, 184, 1); steps(0, 2);
    assert(game_get_flags() & GAME_FLAG_DEAD);
    arena(); game_edit_tile(0, 1, 23, 2); game_set_player(1, 84, 184, 1); steps(GAME_INPUT_ACTION, 2);
    assert(game_get_health() == 3);
    arena(); game_set_player(1, 84, 20, 1); steps(0, 60);
    assert(game_get_health() == 2); assert(game_get_player_grounded());
    arena(); game_edit_tile(0, 1, 23, 18); game_set_player(1, 84, 184, 1); steps(0, 100);
    assert(game_get_flags() & GAME_FLAG_DEAD);
}
static void test_gate_events_and_exit(void) {
    arena(); game_edit_tile(0, 1, 23, 15); game_edit_tile(0, 1, 26, 4);
    assert(game_edit_event(0, 0, 1, 23, 0, 1, 26));
    game_set_player(1, 84, 184, 1); steps(0, 40);
    assert(game_get_gate(1, 26) == 64);
    steps(GAME_INPUT_RIGHT, 45); assert(game_get_player_x() > 166);
    assert(game_edit_event(0, 0, 1, 23, 1, 1, 26));
    game_trigger(1, 23); steps(0, 270); assert(game_get_gate(1, 26) == 0);
    arena(); game_edit_tile(0, 1, 23, 15); game_edit_tile(0, 1, 26, 16);
    game_edit_event(0, 0, 1, 23, 0, 1, 26);
    game_trigger(1, 23); steps(0, 35); game_set_player(1, 156, 184, 1); steps(0, 2);
    steps(GAME_INPUT_UP, 1); assert(game_get_flags() & GAME_FLAG_LEVEL_COMPLETE);
    steps(0, 90); assert(game_get_level() == 1);
}
static void test_pickups_and_loose_floor(void) {
    arena(); game_edit_tile(0, 1, 23, 22); game_set_player(1, 84, 184, 1); steps(0, 2);
    steps(GAME_INPUT_DOWN, 1); assert(game_get_has_sword()); assert((game_get_tile(1, 23) & 31) == 1);
    arena(); game_edit_tile(0, 1, 23, 74); game_set_player(1, 84, 184, 1); steps(0, 2);
    steps(GAME_INPUT_DOWN, 1); assert(game_get_max_health() == 4); assert(game_get_health() == 4);
    arena(); game_edit_tile(0, 1, 23, 11); game_set_player(1, 84, 184, 1); steps(0, 2);
    assert(game_get_tile_state(1, 23) > 0); steps(0, 30); assert((game_get_tile(1, 23) & 31) == 0);
    steps(0, 35); assert(game_get_flags() & GAME_FLAG_DEAD);
    game_reset(); assert((game_get_tile(1, 23) & 31) == 11); assert(game_get_health() == 3);
}
static void test_combat_and_timer(void) {
    int i, initial;
    arena(); game_edit_guard(0, 1, 25); game_reset(); game_set_has_sword(1);
    game_set_player(1, 110, 184, 1); steps(0, 2);
    for (i = 0; i < 8 && game_get_guard_active(1); ++i) {
        steps(GAME_INPUT_ACTION, 1); steps(GAME_INPUT_UP, 35);
    }
    assert(game_get_guard_health(1) < 3);
    assert(!game_get_guard_active(1)); assert(game_get_health() > 0);
    arena(); initial = game_get_time_left(); steps(0, 60); assert(game_get_time_left() == initial - 1);
    game_set_paused(1); steps(GAME_INPUT_RIGHT, 120); assert(game_get_time_left() == initial - 1);
    assert(game_get_flags() & GAME_FLAG_PAUSED);
}
static void test_ledge_grab_and_climb(void) {
    int i;
    arena(); game_edit_tile(0, 1, 15, 1);
    /* Row-one ledge begins at x120 with air to its left. */
    game_set_player(1, 110, 184, 1); steps(0, 2);
    steps(GAME_INPUT_ACTION | GAME_INPUT_JUMP, 1);
    for (i = 0; i < 70 && game_get_player_state() != GAME_HANG; ++i) steps(GAME_INPUT_ACTION, 1);
    assert(game_get_player_state() == GAME_HANG);
    steps(GAME_INPUT_ACTION | GAME_INPUT_UP, 1); assert(game_get_player_state() == GAME_CLIMB);
    steps(0, 24); assert(game_get_player_y() == 120); assert(game_get_player_x() == 132);
    assert(game_get_player_grounded());
}
static void test_campaign_stress(void) {
    uint32_t seed = 0x71337337u;
    int level, frame;
    game_init();
    for (level = 0; level < game_get_level_count(); ++level) {
        game_select_level(level);
        for (frame = 0; frame < 6000; ++frame) {
            if (frame % 13 == 0) {
                seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
                game_set_input((int)(seed & 63));
            }
            game_step();
            assert(game_get_room() >= 1 && game_get_room() <= 24);
            assert(game_get_room_present(game_get_room()));
            assert(game_get_health() >= 0 && game_get_health() <= game_get_max_health());
            if (game_get_flags() & GAME_FLAG_DEAD) {
                game_set_input(0); game_reset();
            }
        }
    }
}
int main(void) {
    test_campaign_and_bounds(); test_floor_wall_and_jump(); test_room_links();
    test_hazards_and_fall_damage(); test_gate_events_and_exit();
    test_pickups_and_loose_floor(); test_combat_and_timer(); test_ledge_grab_and_climb();
    test_campaign_stress();
    puts("C gameplay tests passed: campaign bounds, collision, jump, room links, hazards, events, exits, pickups, loose floors, combat, timer, ledges.");
    return 0;
}
